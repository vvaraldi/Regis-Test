/**
 * photo-service.js - Shared photo handling for the portal
 * =========================================================
 * Consolidates the photo pipelines currently duplicated across:
 *   pages/infraction-report.html      (uploadPhoto + compressImage)
 *   pages/signalisation-report.html   (uploadPhoto + compressImage - verbatim copy)
 *   pages/inspection-trail-report.html   (inline EXIF + Promise.all upload)
 *   pages/inspection-shelter-report.html (inline EXIF + Promise.all upload)
 *
 * COMPRESSION
 * -----------
 * All four modules now compress anything over 1MB to 1200px wide at q0.7.
 * EXIF is read from the ORIGINAL file before compression, so GPS and capture
 * time still reach Firestore. The stored JPEG itself carries no EXIF, since a
 * canvas re-encode drops it - this already applied to infraction and
 * signalisation and is why coordinates live in the document, not the file.
 *
 * PRESERVES EXISTING BEHAVIOUR ON PURPOSE
 * ---------------------------------------
 * Storage paths are kept per-module, byte-for-byte identical to what each page
 * writes today. Do not "tidy" these: pages/inspection-admin.html scans
 * storage.ref('inspections/trails') and storage.ref('inspections/shelters')
 * for orphan cleanup. Any new path scheme would place photos outside the
 * scanned tree and the cleanup tool would stop seeing them.
 *
 * Filenames are also passed through unsanitised, matching current behaviour.
 * Set sanitize:true per call only if you have verified nothing depends on the
 * raw name.
 *
 * STORED SHAPE
 * ------------
 * Every module stores its photos as  photos: [{url, filename, coordinates, timestamp}]
 * (maintenance logs: entries[].photos). The older shapes (a list of plain addresses, or a single
 * photoUrl / offenderImageUrl field) were converted once, in October 2026, by
 * tools/migrate-old-formats.js; this file no longer reads them. Signalisations and infractions
 * still keep a copy of the first photo's position in `coordinates` / `offenderImageCoordinates`
 * (the map markers read it).
 *
 * DEPENDENCIES
 *   firebase compat SDK (storage) via js/core/firebase-loader.js
 *   exif-js (optional) - degrades to null coordinates when absent
 *
 * USAGE
 *   <script src="../js/services/photo-service.js"></script>
 */

(function (global) {
  'use strict';

  // ─── Module profiles: existing conventions, do not change lightly ──────────

  var MODULES = {
    infraction: {
      // stamp is offset by the file's index so two photos with the same name
      // in one batch cannot resolve to the same path (Android galleries hand
      // out "image.jpg" repeatedly). Still a single number, so the path shape
      // is unchanged.
      path: function (o) {
        return 'infractions/' + o.userId + '/' + (o.stamp + o.index) + '_' + o.filename;
      },
      compress: { overBytes: 1024 * 1024, quality: 0.7, maxWidth: 1200 },
      parallel: false
    },
    signalisation: {
      path: function (o) {
        return 'signalisations/' + o.userId + '/' + (o.stamp + o.index) + '_' + o.filename;
      },
      compress: { overBytes: 1024 * 1024, quality: 0.7, maxWidth: 1200 },
      parallel: false
    },
    'inspection-trail': {
      path: function (o) {
        return 'inspections/trails/' + o.recordId + '/' + o.index + '-' + o.filename;
      },
      // Enabled deliberately (was full-size). Same rule as the other modules:
      // trail inspections are filed from the mountain over cell service, and
      // ten 10MB photos was the worst case.
      compress: { overBytes: 1024 * 1024, quality: 0.7, maxWidth: 1200 },
      parallel: true
    },
    'inspection-shelter': {
      path: function (o) {
        return 'inspections/shelters/' + o.recordId + '/' + o.index + '-' + o.filename;
      },
      compress: { overBytes: 1024 * 1024, quality: 0.7, maxWidth: 1200 },
      parallel: true
    },
    maintenance: {
      // Same shape as infraction/signalisation (per-user folder, not per-record):
      // a maintenance log has several entries, each with its own PhotoPicker, so
      // callers pass a distinct `stamp` per entry to keep paths from colliding.
      path: function (o) {
        return 'maintenance/' + o.userId + '/' + (o.stamp + o.index) + '_' + o.filename;
      },
      compress: { overBytes: 1024 * 1024, quality: 0.7, maxWidth: 1200 },
      parallel: false
    }
  };

  // ─── Internal helpers ──────────────────────────────────────────────────────

  function getStorage() {
    if (global.storage) return global.storage;
    if (global.firebase && typeof global.firebase.storage === 'function') {
      return global.firebase.storage();
    }
    throw new Error('Firebase Storage non initialise');
  }

  function profileFor(moduleName) {
    var p = MODULES[moduleName];
    if (!p) throw new Error('Module photo inconnu: ' + moduleName);
    return p;
  }

  function filenameFromUrl(url) {
    if (!url || typeof url !== 'string') return 'photo.jpg';
    try {
      var path = url.split('?')[0];
      var last = decodeURIComponent(path.substring(path.lastIndexOf('/') + 1));
      var slash = last.lastIndexOf('/');
      if (slash !== -1) last = last.substring(slash + 1);
      return last || 'photo.jpg';
    } catch (e) {
      return 'photo.jpg';
    }
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') {
      try { return value.toDate(); } catch (e) { return null; }
    }
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // ─── EXIF ──────────────────────────────────────────────────────────────────

  function extractExifData(file) {
    return new Promise(function (resolve) {
      if (typeof global.EXIF === 'undefined') { resolve(null); return; }
      try {
        global.EXIF.getData(file, function () {
          var tags = global.EXIF.getAllTags(this);
          resolve(tags && Object.keys(tags).length > 0 ? tags : null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function extractGpsFromExif(exifData) {
    if (!exifData) return null;
    var lat = exifData.GPSLatitude, latRef = exifData.GPSLatitudeRef;
    var lon = exifData.GPSLongitude, lonRef = exifData.GPSLongitudeRef;
    if (!lat || !lon || !latRef || !lonRef) return null;
    try {
      var toDecimal = function (dms, ref) {
        var part = function (v) {
          return (typeof v === 'object' && v !== null) ? v.numerator / v.denominator : v;
        };
        var dec = part(dms[0]) + part(dms[1]) / 60 + part(dms[2]) / 3600;
        if (ref === 'S' || ref === 'W') dec = -dec;
        return Math.round(dec * 1000000) / 1000000;
      };
      return { latitude: toDecimal(lat, latRef), longitude: toDecimal(lon, lonRef) };
    } catch (e) { return null; }
  }

  function extractTimestampFromExif(exifData) {
    if (!exifData) return null;
    var dateStr = exifData.DateTimeOriginal || exifData.DateTime;
    if (!dateStr) return null;
    try {
      var parts = dateStr.split(' ');
      var d = parts[0].split(':');
      var t = parts[1].split(':');
      var parsed = new Date(d[0], d[1] - 1, d[2], t[0], t[1], t[2]);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch (e) { return null; }
  }

  async function readExif(file) {
    try {
      var exif = await extractExifData(file);
      return {
        coordinates: extractGpsFromExif(exif),
        timestamp: extractTimestampFromExif(exif)
      };
    } catch (e) {
      console.warn('EXIF extraction failed:', e);
      return { coordinates: null, timestamp: null };
    }
  }

  // ─── Compression ───────────────────────────────────────────────────────────

  /**
   * Same canvas resize used today by infraction and signalisation.
   * Resolves to the original file if the browser cannot produce a blob.
   */
  function compressImage(file, quality, maxWidth) {
    return new Promise(function (resolve) {
      var objectUrl = null;
      var finish = function (result) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(result);
      };
      try {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(function (blob) {
              // Free the backing store immediately - iOS Safari counts total
              // live canvas area against a hard limit.
              canvas.width = 1;
              canvas.height = 1;
              finish(blob || file);
            }, 'image/jpeg', quality);
          } catch (e) {
            console.warn('Compression echouee, envoi de l\'original:', e);
            finish(file);
          }
        };
        img.onerror = function () { finish(file); };
        objectUrl = URL.createObjectURL(file);
        img.src = objectUrl;
      } catch (e) {
        finish(file);
      }
    });
  }

  async function maybeCompress(file, rule) {
    if (!rule || file.size <= rule.overBytes) return file;
    return compressImage(file, rule.quality, rule.maxWidth);
  }

  // ─── Hand-set location ─────────────────────────────────────────────────────
  //
  // An admin or the owner of a record can place a photo on the map (or correct its GPS position).
  // The photo then carries a `locationEdit` record:
  //   locationEdit: { original, by, byName, at }
  //     original  the position the photo had before the FIRST hand-set change ({latitude, longitude}),
  //               or null when it had none - "reset" puts it back (and is only offered when not null)
  //     by/byName who set it, at when (a Timestamp in Firestore, a Date in memory)
  // Firestore cannot hold a server timestamp inside an array, so `at` is a client Timestamp.

  function readLocationEdit(raw) {
    return {
      original: raw.original || null,
      by: raw.by || null,
      byName: raw.byName || null,
      at: toDate(raw.at)
    };
  }

  function writeLocationEdit(edit) {
    var TS = global.firebase && global.firebase.firestore ? global.firebase.firestore.Timestamp : null;
    var at = edit.at;
    if (at && TS && !at.toDate && at.seconds === undefined) at = TS.fromDate(at instanceof Date ? at : new Date(at));
    return { original: edit.original || null, by: edit.by || null, byName: edit.byName || null, at: at || null };
  }

  /** Who is making the change: the signed-in user. */
  function currentEditor() {
    var user = global.currentUser, data = global.currentUserData;
    return { uid: user ? user.uid : null, name: (data && data.name) || (user && user.email) || null };
  }

  // The field that says who owns a record, per collection (the Firestore rules use the same ones).
  var OWNER_FIELDS = {
    trail_inspections: 'inspector_id',
    shelter_inspections: 'inspector_id',
    infractions: 'patrolId',
    signalisations: 'inspectorId',
    maintenance_logs: 'builderId'
  };

  // Infractions and signalisations also keep a copy of the first photo's position (the map markers read it)
  var MIRROR_FIELDS = { signalisations: 'coordinates', infractions: 'offenderImageCoordinates' };

  /** May the signed-in user change the photo positions of this record? An admin, or its owner. */
  function canEditLocation(collection, record) {
    var user = global.currentUser, data = global.currentUserData;
    if (!user || !data || !record) return false;
    if (data.role === 'admin' || data.role === 'system_admin') return true;
    var field = OWNER_FIELDS[collection];
    return !!field && !!record[field] && record[field] === user.uid;
  }

  function validPosition(c) {
    return !!c && typeof c.latitude === 'number' && typeof c.longitude === 'number' &&
      isFinite(c.latitude) && isFinite(c.longitude) && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180;
  }

  /**
   * The photo (any object with coordinates / locationEdit) after a hand-set change. Pure.
   *   change = { coordinates: {latitude, longitude} }   place it there
   *   change = { reset: true }                           back to the original position
   */
  function relocate(photo, change, editor, now) {
    var out = Object.assign({}, photo);
    if (change.reset) {
      if (!(out.locationEdit && out.locationEdit.original)) throw new Error('Aucune position d\'origine à rétablir.');
      out.coordinates = out.locationEdit.original;
      delete out.locationEdit;
      return out;
    }
    if (!validPosition(change.coordinates)) throw new Error('Position GPS invalide.');
    var original = out.locationEdit ? out.locationEdit.original : (out.coordinates || null);
    out.coordinates = {
      latitude: Math.round(change.coordinates.latitude * 1e6) / 1e6,
      longitude: Math.round(change.coordinates.longitude * 1e6) / 1e6
    };
    out.locationEdit = { original: original || null, by: (editor && editor.uid) || null, byName: (editor && editor.name) || null, at: now || new Date() };
    return out;
  }

  /**
   * What to write to a Firestore document to change one photo's position (found by its URL):
   * in `photos` (all modules) or in `entries[].photos` (maintenance). Pure: returns
   * { fields, photo } without touching Firestore.
   */
  function applyLocationChange(data, collection, url, change, editor, now) {
    var change2 = function (photo) {
      var next = relocate(photo, change, editor, now);
      if (next.locationEdit) next.locationEdit = writeLocationEdit(next.locationEdit);
      return next;
    };
    var urlOf = function (p) { return p && p.url; };
    var mirror = MIRROR_FIELDS[collection];

    var photos = Array.isArray(data.photos) ? data.photos.slice() : [];
    var index = photos.findIndex(function (p) { return urlOf(p) === url; });
    if (index !== -1) {
      var updated = change2(photos[index]);
      photos[index] = updated;
      var fields = { photos: photos };
      if (mirror && index === 0) fields[mirror] = updated.coordinates || null;
      return { fields: fields, photo: updated };
    }

    if (Array.isArray(data.entries)) {
      for (var e = 0; e < data.entries.length; e++) {
        var entryPhotos = Array.isArray(data.entries[e].photos) ? data.entries[e].photos.slice() : [];
        var j = entryPhotos.findIndex(function (p) { return urlOf(p) === url; });
        if (j !== -1) {
          var changed = change2(entryPhotos[j]);
          entryPhotos[j] = changed;
          var entries = data.entries.slice();
          entries[e] = Object.assign({}, entries[e], { photos: entryPhotos });
          return { fields: { entries: entries }, photo: changed };
        }
      }
    }

    throw new Error('Photo introuvable dans ce rapport (a-t-elle été retirée ?).');
  }

  /**
   * Changes one photo's position in Firestore. Re-reads the record inside a transaction, so a change
   * made meanwhile on another photo of the same report is not overwritten. Resolves to the new photo.
   */
  async function updateLocation(collection, docId, url, change, editor) {
    var ref = global.db.collection(collection).doc(docId);
    var result = null;
    await global.db.runTransaction(async function (tx) {
      var snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Rapport introuvable.');
      var res = applyLocationChange(snap.data(), collection, url, change, editor || currentEditor(), new Date());
      tx.update(ref, res.fields);
      result = res.photo;
    });
    return result;
  }
  // ─── Reading ───────────────────────────────────────────────────────────────

  /** Normalises one stored photo ({url, filename, coordinates, timestamp, locationEdit}); null when it has no address. */
  function normalizePhoto(raw) {
    if (!raw) return null;

    if (typeof raw === 'object' && raw.url) {
      var photo = {
        url: raw.url,
        filename: raw.filename || filenameFromUrl(raw.url),
        coordinates: raw.coordinates || null,
        timestamp: toDate(raw.timestamp)
      };
      if (raw.locationEdit) photo.locationEdit = readLocationEdit(raw.locationEdit);
      return photo;
    }

    return null;
  }

  /**
   * Every photo on a document, normalised (without duplicates).
   * Read paths should call this instead of touching doc.photos directly.
   */
  function photosFrom(docData) {
    if (!docData) return [];

    var out = [];
    var seen = {};

    function push(photo) {
      if (photo && photo.url && !seen[photo.url]) {
        seen[photo.url] = true;
        out.push(photo);
      }
    }

    if (Array.isArray(docData.photos)) {
      docData.photos.forEach(function (p) {
        push(normalizePhoto(p));
      });
    }

    return out;
  }

  function firstPhotoUrl(docData) {
    var photos = photosFrom(docData);
    return photos.length ? photos[0].url : null;
  }

  /**
   * The scalar GPS mirror that infraction and signalisation still write for
   * map-marker retrocompat. Keep writing it until the map reads photos[].
   */
  function primaryCoordinates(photos) {
    if (!photos || !photos.length) return null;
    return photos[0].coordinates || null;
  }

  /**
   * Converts service records into the exact shape the pages store today,
   * with Firestore Timestamps. Replaces the repeated .map() in every submit
   * and modify handler.
   */
  function toFirestore(photos) {
    var TS = global.firebase && global.firebase.firestore
      ? global.firebase.firestore.Timestamp
      : null;

    return (photos || []).map(function (p) {
      var out = {
        url: p.url,
        filename: p.filename,
        coordinates: p.coordinates || null,
        timestamp: (p.timestamp && TS) ? TS.fromDate(p.timestamp) : null
      };
      if (p.locationEdit) out.locationEdit = writeLocationEdit(p.locationEdit);
      return out;
    });
  }

  // ─── Writing ───────────────────────────────────────────────────────────────

  /**
   * Accepts a File, or {file, coordinates, timestamp} when EXIF has already
   * been read elsewhere (PhotoPicker does this at pick time).
   */
  function toEntry(item) {
    if (!item) return null;
    if (item.file) {
      return {
        file: item.file,
        exif: (item.coordinates !== undefined || item.timestamp !== undefined)
          ? { coordinates: item.coordinates || null, timestamp: item.timestamp || null }
          : null,
        locationEdit: item.locationEdit || null
      };
    }
    return { file: item, exif: null };
  }

  /**
   * Phase 1: read EXIF and compress. Always sequential - a canvas resize is
   * the memory-hungry part, and iOS Safari caps total live canvas area, so
   * four at once on a 12MP iPhone photo can fail (toBlob returns null and the
   * original gets uploaded instead).
   *
   * EXIF is skipped when the caller already has it, so a PhotoPicker upload
   * does not parse every file a second time.
   */
  async function prepareOne(entry, moduleName, options) {
    var profile = profileFor(moduleName);
    var exif = entry.exif || await readExif(entry.file);
    var rule = (options.compress === undefined) ? profile.compress : options.compress;
    var payload = await maybeCompress(entry.file, rule);
    return { file: entry.file, payload: payload, exif: exif, locationEdit: entry.locationEdit || null };
  }

  /**
   * Phase 2: the network put. Safe to run in parallel - it is I/O, not memory.
   */
  async function putOne(prepared, moduleName, options, index) {
    var profile = profileFor(moduleName);
    var storageRef = getStorage();

    var path = profile.path({
      userId: options.userId,
      recordId: options.recordId,
      stamp: options.stamp,
      index: index,
      filename: prepared.file.name
    });

    var ref = storageRef.ref(path);
    await ref.put(prepared.payload);
    var url = await ref.getDownloadURL();

    var record = {
      url: url,
      filename: prepared.file.name,
      coordinates: prepared.exif.coordinates,
      timestamp: prepared.exif.timestamp
    };
    if (prepared.locationEdit) record.locationEdit = prepared.locationEdit;
    return record;
  }

  /**
   * Uploads photos for one module.
   *
   * @param {Array} files  File objects, or {file, coordinates, timestamp}
   *                       entries when EXIF has already been read
   * @param {string} moduleName  'infraction' | 'signalisation'
   *                             | 'inspection-trail' | 'inspection-shelter'
   * @param {Object} options
   *   userId     {string}   required for infraction / signalisation paths
   *   recordId   {string}   required for inspection paths
   *   stamp      {number}   optional - defaults to Date.now()
   *   compress   {Object|null} optional - overrides the module default
   *   parallel   {boolean}  optional - overrides the module default
   *   onProgress {Function} optional - (done, total)
   * @returns {Promise<Array>} photo records (not yet Firestore-shaped)
   */
  async function uploadFiles(files, moduleName, options) {
    options = options || {};
    var list = Array.prototype.slice.call(files || [])
      .map(toEntry)
      .filter(Boolean);
    if (!list.length) return [];

    var profile = profileFor(moduleName);
    var opts = {
      userId: options.userId,
      recordId: options.recordId,
      stamp: options.stamp || Date.now(),
      compress: options.compress
    };

    var parallel = (options.parallel === undefined) ? profile.parallel : options.parallel;
    var done = 0;

    var tick = function () {
      done += 1;
      if (typeof options.onProgress === 'function') options.onProgress(done, list.length);
    };

    // Phase 1 - always sequential (canvas memory).
    var prepared = [];
    for (var p = 0; p < list.length; p++) {
      prepared.push(await prepareOne(list[p], moduleName, opts));
    }

    // Phase 2 - parallel where the module allows it (network only).
    if (parallel) {
      return Promise.all(prepared.map(async function (item, i) {
        var rec = await putOne(item, moduleName, opts, i);
        tick();
        return rec;
      }));
    }

    var out = [];
    for (var i = 0; i < prepared.length; i++) {
      out.push(await putOne(prepared[i], moduleName, opts, i));
      tick();
    }
    return out;
  }

  /**
   * Uploads a PhotoPicker's pending files, marks them uploaded, and returns
   * the complete set (previously uploaded + new). Replaces the identical
   * for-loop at the top of every submit and modify handler.
   */
  async function uploadFromPicker(picker, moduleName, options) {
    if (!picker) return [];

    var existing = picker.getUploadedPhotos ? picker.getUploadedPhotos() : [];
    var pending = picker.getPendingFiles ? picker.getPendingFiles() : [];

    if (!pending.length) {
      return existing.map(function (p) { return normalizePhoto(p); }).filter(Boolean);
    }

    var uploaded = await uploadFiles(pending, moduleName, options);

    uploaded.forEach(function (photo) {
      if (picker.markAsUploaded) picker.markAsUploaded(photo.filename, photo.url);
    });

    // Built from what we actually uploaded rather than re-reading the picker.
    // markAsUploaded() matches on filename, so two files with the same name in
    // one batch would mark the same entry twice and lose the second photo.
    return existing.concat(uploaded)
      .map(function (p) { return normalizePhoto(p); })
      .filter(Boolean);
  }

  // ─── Deleting ──────────────────────────────────────────────────────────────

  /**
   * Deletes photos from Storage. Failures are logged, never thrown - a missing file must
   * not block deleting the document that points at it.
   */
  async function deletePhotos(photos) {
    var list = (Array.isArray(photos) ? photos : [photos])
      .map(function (p) { return normalizePhoto(p); })
      .filter(Boolean);

    if (!list.length) return { deleted: 0, failed: 0 };

    var storageRef = getStorage();

    var outcomes = await Promise.allSettled(list.map(function (photo) {
      return storageRef.refFromURL(photo.url).delete().catch(function (e) {
        console.warn('Suppression de photo echouee: ' + photo.url, e);
        throw e;
      });
    }));

    var deleted = outcomes.filter(function (o) { return o.status === 'fulfilled'; }).length;
    return { deleted: deleted, failed: outcomes.length - deleted };
  }

  function deletePhotosFrom(docData) {
    return deletePhotos(photosFrom(docData));
  }

  /**
   * After an edit has been saved: deletes the files the record showed before
   * and no longer does. A file another record of the same owner still points
   * to is kept - a duplicated report shares its files with the original.
   * Never throws: a leftover file is better than a failed save, and if the
   * sibling check cannot run, nothing is deleted.
   *
   * before / after  URLs the form loaded / the URLs the record now holds
   * siblingsQuery   the owner's records, e.g. col.where('patrolId', '==', uid)
   * excludeId       the edited record (already saved, so it only holds `after`)
   * extraUrlFields  non-photo URL fields that also count as references
   *                 (e.g. the infraction QR image)
   */
  async function deleteRemoved(before, after, siblingsQuery, excludeId, extraUrlFields) {
    var kept = {};
    (after || []).forEach(function (u) { kept[u] = true; });
    var removed = (before || []).filter(function (u, i, all) {
      return u && !kept[u] && all.indexOf(u) === i;
    });
    if (!removed.length) return { deleted: 0, failed: 0, kept: 0 };

    var inUse = {};
    try {
      var snap = await siblingsQuery.get();
      snap.forEach(function (doc) {
        if (doc.id === excludeId) return;
        var data = doc.data();
        urlsFrom(data).forEach(function (u) { inUse[u] = true; });
        (extraUrlFields || []).forEach(function (f) { if (data[f]) inUse[data[f]] = true; });
      });
    } catch (e) {
      console.warn('Verification des photos partagees echouee, aucune suppression:', e);
      return { deleted: 0, failed: 0, kept: removed.length };
    }

    var doomed = removed.filter(function (u) { return !inUse[u]; });
    var result = await deletePhotos(doomed);
    return { deleted: result.deleted, failed: result.failed, kept: removed.length - doomed.length };
  }

  /**
   * Every photo URL on a document - for inspection-admin's orphan scanner,
   * which currently repeats the string/object check twice.
   */
  function urlsFrom(docData) {
    return photosFrom(docData).map(function (p) { return p.url; });
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  global.PhotoService = {
    MODULES: MODULES,
    // reading
    normalizePhoto: normalizePhoto,
    photosFrom: photosFrom,
    firstPhotoUrl: firstPhotoUrl,
    urlsFrom: urlsFrom,
    primaryCoordinates: primaryCoordinates,
    canEditLocation: canEditLocation,
    currentEditor: currentEditor,
    relocate: relocate,
    applyLocationChange: applyLocationChange,
    updateLocation: updateLocation,
    toFirestore: toFirestore,
    // exif
    readExif: readExif,
    extractExifData: extractExifData,
    extractGpsFromExif: extractGpsFromExif,
    extractTimestampFromExif: extractTimestampFromExif,
    // writing
    compressImage: compressImage,
    uploadFiles: uploadFiles,
    uploadFromPicker: uploadFromPicker,
    // deleting
    deletePhotos: deletePhotos,
    deletePhotosFrom: deletePhotosFrom,
    deleteRemoved: deleteRemoved
  };

})(typeof window !== 'undefined' ? window : this);