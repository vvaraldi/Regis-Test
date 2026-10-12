/**
 * photo-map-modal.js - "Localisation de la photo" pop-up
 * ========================================================
 * Shows where a photo was taken on a map. Every caller offers the same switch, between the
 * activity's report maps (APP_CONFIG.networks[id].reportMaps - for ski the downhill and touring
 * geolocalisation maps; for bike, just the one, so no switch shows there), since a report or an
 * inspection photo can in principle be anywhere on the mountain.
 *
 *   PhotoMapModal.open(lat, lon)              opens on the network's default report map
 *                                             (reportMaps' first entry).
 *   PhotoMapModal.open(lat, lon, preferred)   opens on `preferred` instead, when it is one of the
 *                                             offered maps - e.g. inspection dashboard/history
 *                                             pass the photo's own trail kind's map
 *                                             (TrailService.geoMapIdOf), infraction/signalisation
 *                                             pages pass the report's resolved kind when one can
 *                                             be inferred (its trail, or its sector when every
 *                                             trail of that sector shares one kind). Falls back to
 *                                             the network default when `preferred` isn't offered.
 *   PhotoMapModal.close()
 *
 * RELOCATION (an admin, or the owner of the record, places or corrects a photo's position):
 *   PhotoMapModal.locationLinks(photo, ctx)   the HTML of the links under a photo in a detail view:
 *                                             Carte / Google Maps (when it has a position) and, for
 *                                             who may edit, ✏️ (or "📍 Ajouter" without a position).
 *                                             ctx = { collection, docId, record, preferredMap, onChanged }.
 *                                             Saving writes to Firestore (PhotoService.updateLocation),
 *                                             then calls ctx.onChanged() so the page can reload.
 *   PhotoMapModal.edit(opts)                  the dialog itself, used by the links and by PhotoPicker
 *                                             (report forms, where the change is saved with the form):
 *                                             opts = { photoUrl, coordinates, original, preferred, save(change) }
 *                                             change = { coordinates: {latitude, longitude} } | { reset: true }
 *   The dialog shows the photo beside the geolocalisation map; a click on the map becomes GPS
 *   (MapService.pixelToGps), GPS can also be typed or pasted; the maps are the activity's report maps
 *   (ski: Montée / Descente switch). original (the position before the first hand-set change)
 *   enables "Rétablir la position d'origine".
 *
 * Either way: opens Google Maps instead when no offered map can place the position at all (none
 * calibrated - a calibrated map's gpsToPixel always returns a pixel, clamped to the image edges,
 * even for a position outside its coverage, so this is never about being "out of bounds").
 * Once the switch has been used, the picked map is kept (pinned) for subsequent photos while the
 * page stays open, taking priority over any `preferred` passed later. Every map can be picked:
 * one with no GPS calibration yet (Administration > Cartes) is shown without the marker, with a
 * note.
 *
 * Uses the .detail-modal markup (infraction-admin, signalisation-admin, signalisation-resume,
 * maintenance-admin, inspection-history already have it; inspection-dashboard has its own copy of
 * the same rules).
 * Requires config.js, network.js and map-service.js (also trail-service.js for callers that pass
 * a `preferred` derived from TrailService).
 */
const PhotoMapModal = (function () {
  'use strict';

  let chosen = null;      // map id being shown
  let pinned = null;      // map id the user picked with the switch (kept while the page stays open)
  let position = null;    // { lat, lon } being shown

  const $ = id => document.getElementById(id);
  const mapsOffered = () => MapService.reportMaps().all;

  function build() {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="detail-modal" id="photo-map-modal">
        <div class="detail-modal__content" style="max-width:900px;">
          <div class="detail-modal__header"><h3 class="detail-modal__title">📍 Localisation de la photo</h3><button class="detail-modal__close" onclick="PhotoMapModal.close()">×</button></div>
          <div class="detail-modal__body" style="padding:0;">
            <div id="photo-map-switch" style="display:none;gap:0.5rem;padding:0.75rem 1rem;border-bottom:1px solid var(--theme-border);flex-wrap:wrap;"></div>
            <div style="overflow:auto;max-height:60vh;"><div id="photo-map-wrap" style="position:relative;display:inline-block;"><img id="photo-map-img" alt="" style="display:block;width:auto;height:auto;max-width:none;"><div id="photo-marker" style="position:absolute;width:20px;height:20px;background:red;border:3px solid white;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div></div></div>
            <div id="photo-coords" style="padding:1rem;background:var(--theme-surface-alt);border-top:1px solid var(--theme-border);"></div>
          </div>
          <div class="detail-modal__footer"><a id="photo-google-link" href="#" target="_blank" rel="noopener noreferrer" class="btn btn-primary">🗺️ Google Maps</a><button class="btn btn-secondary" onclick="PhotoMapModal.close()">Fermer</button></div>
        </div>
      </div>`);
    $('photo-map-modal').addEventListener('click', e => { if (e.target.id === 'photo-map-modal') close(); });
  }

  // Draws the chosen map, the marker and the switch
  function render() {
    const all = mapsOffered();
    const { lat, lon } = position;

    const box = $('photo-map-switch');
    box.replaceChildren();
    box.style.display = all.length > 1 ? 'flex' : 'none';
    all.forEach(id => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm ' + (id === chosen ? 'btn-primary' : 'btn-secondary');
      button.textContent = `${APP_CONFIG.maps[id].icon} ${APP_CONFIG.maps[id].name}`;
      if (!MapService.gpsToPixel(lat, lon, id)) button.title = 'Carte non calibrée (Administration > Cartes) : la position ne peut pas y être placée';
      button.addEventListener('click', () => { chosen = pinned = id; render(); });
      box.appendChild(button);
    });

    // The chosen map is always shown; the marker only when it can place the position
    const pixel = MapService.gpsToPixel(lat, lon, chosen);
    const image = $('photo-map-img');
    const wrap = $('photo-map-wrap').parentElement;
    const center = () => {
      wrap.scrollLeft = pixel ? Math.max(0, pixel.x - wrap.clientWidth / 2) : 0;
      wrap.scrollTop = pixel ? Math.max(0, pixel.y - wrap.clientHeight / 2) : 0;
    };
    image.onload = center;
    const url = MapService.imageUrl(chosen);
    if (image.getAttribute('src') !== url) image.src = url; else center();
    image.alt = `Carte ${APP_CONFIG.maps[chosen].name}`;
    $('photo-marker').style.display = pixel ? '' : 'none';
    if (pixel) {
      $('photo-marker').style.left = pixel.x + 'px';
      $('photo-marker').style.top = pixel.y + 'px';
    }
    $('photo-coords').innerHTML = `<strong>GPS:</strong> ${lat.toFixed(6)}°, ${lon.toFixed(6)}°` +
      (pixel ? '' : `<br><span style="color:var(--theme-text-secondary);">La position ne peut pas être placée sur cette carte (carte non calibrée, ou position hors carte) : essayez l'autre carte ci-dessus, ou Google Maps.</span>`);
    $('photo-google-link').href = `https://www.google.com/maps?q=${lat},${lon}`;
  }

  /**
   * @param {number} lat
   * @param {number} lon
   * @param {string} [preferred] open on this map instead of the network default, when it is one
   *   of the offered maps (see file header) - ignored once a map has been pinned by the switch
   */
  function open(lat, lon, preferred) {
    const all = mapsOffered();
    // No map on offer can place the position at all (none calibrated): Google Maps instead
    if (!all.some(id => MapService.gpsToPixel(lat, lon, id))) { window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank', 'noopener'); return; }

    chosen = (pinned && all.includes(pinned)) ? pinned
      : (preferred && all.includes(preferred)) ? preferred
      : MapService.reportMaps().default;
    position = { lat, lon };
    if (!$('photo-map-modal')) build();
    render();
    $('photo-map-modal').classList.add('show');
  }

  function close() {
    const modal = $('photo-map-modal');
    if (modal) modal.classList.remove('show');
  }

  // ===== Relocation dialog ====================================================================
  // Own markup and styles (injected once), so it works on every page, including the report forms.

  const EDITOR_CSS = `
    .pme-overlay{display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);align-items:center;justify-content:center;padding:1rem}
    .pme-overlay.show{display:flex}
    .pme-box{background:var(--theme-surface,#fff);color:var(--theme-text,#111827);border-radius:12px;max-width:960px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden}
    .pme-head{display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;border-bottom:1px solid var(--theme-border,#e5e7eb)}
    .pme-head h3{margin:0;font-size:1.05rem}
    .pme-x{background:none;border:none;font-size:1.6rem;line-height:1;cursor:pointer;color:inherit}
    .pme-body{padding:.75rem 1rem;overflow-y:auto;flex:1}
    .pme-top{display:flex;gap:1rem;align-items:flex-start;margin-bottom:.75rem;flex-wrap:wrap}
    .pme-top img{max-width:220px;max-height:160px;border-radius:8px;border:1px solid var(--theme-border,#e5e7eb);display:block}
    .pme-help{flex:1;min-width:200px;font-size:.875rem;color:var(--theme-text-secondary,#6b7280)}
    .pme-switch{display:none;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem}
    .pme-scroll{overflow:auto;max-height:45vh;border:1px solid var(--theme-border,#e5e7eb);border-radius:8px}
    .pme-wrap{position:relative;display:inline-block;cursor:crosshair}
    .pme-wrap img{display:block;width:auto;height:auto;max-width:none}
    .pme-marker{position:absolute;width:20px;height:20px;background:#dc2626;border:3px solid #fff;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;display:none}
    .pme-coords{margin-top:.75rem}
    .pme-coords label{display:block;font-weight:600;font-size:.875rem;margin-bottom:.25rem}
    .pme-coords input{width:100%;padding:.5rem .75rem;border:1px solid var(--theme-border,#d1d5db);border-radius:8px;font-size:1rem;background:var(--theme-surface,#fff);color:inherit;box-sizing:border-box}
    .pme-status{font-size:.8125rem;margin-top:.35rem;color:var(--theme-text-secondary,#6b7280)}
    .pme-status.is-error{color:#dc2626}
    .pme-original{font-size:.8125rem;margin-top:.25rem;color:var(--theme-text-secondary,#6b7280)}
    .pme-foot{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;padding:.75rem 1rem;border-top:1px solid var(--theme-border,#e5e7eb)}
    .pme-spacer{flex:1}
    .pme-foot [hidden]{display:none}
  `;

  let ed = null; // state of the open dialog: { opts, chosen, position, initial, busy, error }

  const round6 = n => Math.round(n * 1e6) / 1e6;

  /**
   * "45.31012, -72.23011" (as copied from Google Maps), "45.31012 -72.23011", "45,31012; -72,23011".
   * Returns { latitude, longitude }, null for an empty text, undefined when it cannot be understood.
   */
  function parsePosition(text) {
    let s = String(text == null ? '' : text).trim();
    if (!s) return null;
    if (s.includes(';')) s = s.replace(/,/g, '.'); // French decimal commas, pair separated by ";"
    const m = s.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*°?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*\)?$/);
    if (!m) return undefined;
    const latitude = parseFloat(m[1]), longitude = parseFloat(m[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
    return { latitude, longitude };
  }

  function buildEditor() {
    if (!$('pme-style')) document.head.insertAdjacentHTML('beforeend', `<style id="pme-style">${EDITOR_CSS}</style>`);
    document.body.insertAdjacentHTML('beforeend', `
      <div class="pme-overlay" id="pme-modal" role="dialog" aria-modal="true" aria-labelledby="pme-title">
        <div class="pme-box">
          <div class="pme-head"><h3 id="pme-title">📍 Localiser la photo</h3><button type="button" class="pme-x" id="pme-close" aria-label="Fermer">×</button></div>
          <div class="pme-body">
            <div class="pme-top">
              <a id="pme-photo-link" target="_blank" rel="noopener"><img id="pme-photo" alt="Photo à localiser"></a>
              <div class="pme-help">Cliquez sur la carte à l'endroit où la photo a été prise, ou collez les coordonnées GPS ci-dessous (par exemple copiées depuis Google Maps). Cliquez sur la photo pour l'agrandir.</div>
            </div>
            <div class="pme-switch" id="pme-switch"></div>
            <div class="pme-scroll" id="pme-scroll"><div class="pme-wrap"><img id="pme-img" alt=""><div class="pme-marker" id="pme-marker"></div></div></div>
            <div class="pme-coords">
              <label for="pme-input">Coordonnées GPS (latitude, longitude)</label>
              <input type="text" id="pme-input" placeholder="ex. 45.31012, -72.23011" autocomplete="off" inputmode="text">
              <div class="pme-status" id="pme-status" aria-live="polite"></div>
              <div class="pme-original" id="pme-original"></div>
            </div>
          </div>
          <div class="pme-foot">
            <button type="button" class="btn btn-secondary" id="pme-reset" hidden>↩ Rétablir la position d'origine</button>
            <a class="btn btn-secondary" id="pme-google" target="_blank" rel="noopener noreferrer" hidden>🗺️ Google Maps</a>
            <span class="pme-spacer"></span>
            <button type="button" class="btn btn-secondary" id="pme-cancel">Annuler</button>
            <button type="button" class="btn btn-primary" id="pme-save">Enregistrer</button>
          </div>
        </div>
      </div>`);

    $('pme-close').addEventListener('click', editorClose);
    $('pme-cancel').addEventListener('click', editorClose);
    $('pme-modal').addEventListener('click', e => { if (e.target.id === 'pme-modal') editorClose(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ed) editorClose(); });

    // A click on the map -> pixel -> GPS (the reverse of how a position is drawn)
    $('pme-img').addEventListener('click', e => {
      if (!ed || ed.busy) return;
      const map = APP_CONFIG.maps[ed.chosen];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (map.width / rect.width);
      const y = (e.clientY - rect.top) * (map.height / rect.height);
      const gps = MapService.pixelToGps(x, y, ed.chosen);
      if (gps) { ed.position = { latitude: round6(gps.lat), longitude: round6(gps.lon) }; ed.error = null; }
      editorRender();
    });

    // Typed or pasted coordinates
    $('pme-input').addEventListener('input', () => {
      if (!ed) return;
      const parsed = parsePosition($('pme-input').value);
      ed.error = null;
      ed.typed = $('pme-input').value;
      ed.position = parsed || null;
      ed.invalidText = parsed === undefined;
      editorRender(true);
    });

    $('pme-save').addEventListener('click', () => { if (ed && ed.position) editorSave({ coordinates: ed.position }); });
    $('pme-reset').addEventListener('click', () => { if (ed) editorSave({ reset: true }); });
  }

  function editorRender(keepInput) {
    const { opts } = ed;
    const maps = mapsOffered();
    const pos = ed.position;

    const box = $('pme-switch');
    box.replaceChildren();
    box.style.display = maps.length > 1 ? 'flex' : 'none';
    maps.forEach(id => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm ' + (id === ed.chosen ? 'btn-primary' : 'btn-secondary');
      button.textContent = `${APP_CONFIG.maps[id].icon} ${APP_CONFIG.maps[id].name}`;
      if (!MapService.canLocate(id)) button.title = 'Carte non calibrée (Administration > Cartes)';
      button.addEventListener('click', () => { ed.chosen = pinned = id; ed.needsCenter = true; editorRender(); });
      box.appendChild(button);
    });

    const pixel = pos ? MapService.gpsToPixel(pos.latitude, pos.longitude, ed.chosen) : null;
    const image = $('pme-img');
    const scroll = $('pme-scroll');
    const center = () => {
      scroll.scrollLeft = pixel ? Math.max(0, pixel.x - scroll.clientWidth / 2) : 0;
      scroll.scrollTop = pixel ? Math.max(0, pixel.y - scroll.clientHeight / 2) : 0;
    };
    image.onload = center;
    const url = MapService.imageUrl(ed.chosen);
    if (image.getAttribute('src') !== url) image.src = url; else if (ed.needsCenter) center();
    ed.needsCenter = false; // only when the dialog opens or the map changes, never after a click
    image.alt = `Carte ${APP_CONFIG.maps[ed.chosen].name}`;
    const marker = $('pme-marker');
    marker.style.display = pixel ? 'block' : 'none';
    if (pixel) { marker.style.left = pixel.x + 'px'; marker.style.top = pixel.y + 'px'; }

    if (!keepInput) $('pme-input').value = pos ? `${pos.latitude}, ${pos.longitude}` : (ed.typed || '');

    let status, isError = false;
    if (ed.error) { status = ed.error; isError = true; }
    else if (ed.invalidText) { status = 'Coordonnées non reconnues. Exemple : 45.31012, -72.23011'; isError = true; }
    else if (!MapService.canLocate(ed.chosen)) status = 'Cette carte n\'est pas calibrée : un clic ne peut pas y donner de position. Choisissez l\'autre carte, ou collez des coordonnées.';
    else if (!pos) status = 'Cliquez sur la carte pour placer la photo, ou collez des coordonnées GPS.';
    else if (!pixel) status = 'Position choisie, mais elle ne peut pas être dessinée sur cette carte.';
    else status = `Position choisie : ${pos.latitude.toFixed(6)}°, ${pos.longitude.toFixed(6)}°`;
    $('pme-status').textContent = status;
    $('pme-status').classList.toggle('is-error', isError);

    const original = opts.original;
    $('pme-original').textContent = original ? `Position d'origine : ${original.latitude.toFixed(6)}°, ${original.longitude.toFixed(6)}°` : '';
    $('pme-reset').hidden = !original;
    $('pme-reset').disabled = ed.busy;

    const google = $('pme-google');
    google.hidden = !pos;
    if (pos) google.href = `https://www.google.com/maps?q=${pos.latitude},${pos.longitude}`;

    const initial = ed.initial;
    const unchanged = !!(initial && pos && initial.latitude === pos.latitude && initial.longitude === pos.longitude);
    $('pme-save').disabled = ed.busy || !pos || unchanged;
    $('pme-save').textContent = ed.busy ? 'Enregistrement…' : 'Enregistrer';
    $('pme-cancel').disabled = ed.busy;
  }

  async function editorSave(change) {
    ed.busy = true; ed.error = null; editorRender(true);
    try {
      await ed.opts.save(change);
      editorClose();
    } catch (error) {
      console.error('Photo location not saved:', error);
      ed.busy = false;
      ed.error = 'Enregistrement impossible : ' + (error.message || 'erreur inconnue');
      editorRender(true);
    }
  }

  function editorClose() {
    const modal = $('pme-modal');
    if (modal) modal.classList.remove('show');
    ed = null;
  }

  /**
   * Opens the relocation dialog.
   * @param {Object} opts
   *   photoUrl     the photo to show beside the map
   *   coordinates  its current position {latitude, longitude}, or null
   *   original     the position before the first hand-set change, or null (enables the reset button)
   *   preferred    map id to open on (else the activity's default; an uncalibrated map is skipped)
   *   save(change) async; change = { coordinates } | { reset: true }; the dialog closes when it resolves
   */
  function edit(opts) {
    const maps = mapsOffered();
    let chosen = (pinned && maps.includes(pinned)) ? pinned
      : (opts.preferred && maps.includes(opts.preferred)) ? opts.preferred
      : MapService.reportMaps().default;
    if (!MapService.canLocate(chosen)) chosen = maps.find(id => MapService.canLocate(id)) || chosen;

    const current = opts.coordinates && typeof opts.coordinates.latitude === 'number' ? { latitude: opts.coordinates.latitude, longitude: opts.coordinates.longitude } : null;
    ed = { opts, chosen, position: current, initial: current, busy: false, error: null, typed: '', invalidText: false, needsCenter: true };
    if (!$('pme-modal')) buildEditor();
    $('pme-photo').src = opts.photoUrl || '';
    $('pme-photo-link').href = opts.photoUrl || '#';
    $('pme-modal').classList.add('show');
    editorRender();
  }

  // ----- The links under a photo in a detail view -----------------------------------------------

  const registry = {};
  let registryCount = 0;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hasPosition(photo) {
    const c = photo && photo.coordinates;
    return !!c && typeof c.latitude === 'number' && typeof c.longitude === 'number';
  }

  /** HTML of the position links under a photo (see the file header). */
  function locationLinks(photo, ctx) {
    ctx = ctx || {};
    const parts = [];
    const c = photo.coordinates;
    if (hasPosition(photo)) {
      parts.push(`<a href="#" onclick="openPhotoLocationModal(${c.latitude},${c.longitude}${ctx.preferredMap ? `,'${ctx.preferredMap}'` : ''});return false;">📍 Carte</a>`);
      parts.push(`<a href="https://www.google.com/maps?q=${c.latitude},${c.longitude}" target="_blank" rel="noopener noreferrer" title="Google Maps" aria-label="Google Maps">🗺️</a>`);
    }
    const canEdit = ctx.collection && ctx.docId && typeof PhotoService !== 'undefined' && PhotoService.canEditLocation(ctx.collection, ctx.record);
    if (canEdit) {
      const id = 'ploc' + (++registryCount);
      registry[id] = { photo, ctx };
      const label = hasPosition(photo) ? '✏️' : '📍 Ajouter';
      const title = hasPosition(photo) ? 'Modifier la localisation' : 'Ajouter une localisation';
      parts.push(`<a href="#" onclick="PhotoMapModal.editRegistered('${id}');return false;" title="${title}" aria-label="${title}">${label}</a>`);
    }
    if (photo.locationEdit) {
      const at = photo.locationEdit.at;
      const day = at && at.toDate ? at.toDate() : at;
      const when = day && day.toLocaleDateString ? day.toLocaleDateString('fr-CA') : '';
      parts.push(`<span class="photo-location__edited" title="${esc(`Position définie à la main par ${photo.locationEdit.byName || '?'}${when ? ' le ' + when : ''}`)}">(modifiée)</span>`);
    }
    return parts.length ? `<div class="photo-location">${parts.join(' ')}</div>` : '';
  }

  function editRegistered(id) {
    const entry = registry[id];
    if (!entry) return;
    const { photo, ctx } = entry;
    edit({
      photoUrl: photo.url,
      coordinates: hasPosition(photo) ? photo.coordinates : null,
      original: photo.locationEdit ? photo.locationEdit.original : null,
      preferred: ctx.preferredMap,
      save: async change => {
        await PhotoService.updateLocation(ctx.collection, ctx.docId, photo.url, change);
        if (ctx.onChanged) await ctx.onChanged();
      }
    });
  }
  return { open, close, edit, locationLinks, editRegistered, parsePosition };
})();
window.PhotoMapModal = PhotoMapModal;
window.openPhotoLocationModal = PhotoMapModal.open;
