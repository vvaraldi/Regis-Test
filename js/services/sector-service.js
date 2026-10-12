/**
 * sector-service.js - Sectors and their trails, from Firestore
 * ============================================================
 * One source for the sector -> trail lists used by the infraction and
 * signalisation forms.
 *
 * Firestore `sectors/{id}`:
 *   name     "Mont Giroux Nord"
 *   network  "ski"                       (an id of APP_CONFIG.networks)
 *   order    2                           (position in the dropdown, per network)
 *   aliases  ["giroux-nord"]             (older ids that records may still carry)
 *
 * The trails of a sector are the `trails` records whose `sector` is this sector's id (or one of
 * its aliases), of the sector's activity, not hidden (archived). Every kind counts (uphill,
 * downhill, lift). Infractions offer them all together; the Signalisations pages only show the view
 * selected in the header (Montée = uphill, Descente = downhill + lift: kindsInView in
 * trail-service.js). The sector is set on each trail by a system admin (Administration > Sentiers).
 *
 * A report stores the sector id, the trail name (text) and, when the trail came from a trail
 * record, its id (trailId). Old reports only have the name: readTrail() / selectTrail() below
 * handle both, and an old report is never rewritten unless someone edits it.
 *
 * Requires: firebase-loader.js + auth.js (window.db), config.js (APP_CONFIG), network.js.
 * Load it after auth.js.
 */
(function (global) {
  'use strict';

  var cache = null;        // Promise<Sector[]>, one read per page
  var trailsCache = null;  // Promise<Trail[]>, one read per page

  /** Comparable form of a name: no accents, lower case, one space, straight apostrophes. */
  function norm(text) {
    return String(text == null ? '' : text)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’‘`]/g, "'")
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function compare(a, b) {
    return (a.network || '').localeCompare(b.network || '') ||
      ((a.order == null ? 999 : a.order) - (b.order == null ? 999 : b.order)) ||
      (a.name || '').localeCompare(b.name || '', 'fr');
  }

  /**
   * Every sector of every network, sorted by network then order.
   * Pass force = true to bypass the per-page cache (after an edit).
   */
  function loadAll(force) {
    if (!cache || force) {
      cache = global.db.collection('sectors').get().then(function (snapshot) {
        var list = [];
        snapshot.forEach(function (doc) {
          var data = doc.data();
          list.push(Object.assign({}, data, {
            id: doc.id,
            aliases: data.aliases || []
          }));
        });
        return list.sort(compare);
      });
      // A failed read must not stick: let the next call try again
      cache.catch(function () { cache = null; });
    }
    return cache;
  }

  /** Every trail record ({id, ...data}), read once per page. A failed read gives no trails. */
  function loadTrails(force) {
    if (!trailsCache || force) {
      trailsCache = global.db.collection('trails').get().then(function (snapshot) {
        var list = [];
        snapshot.forEach(function (doc) { list.push(Object.assign({ id: doc.id }, doc.data())); });
        return list;
      }).catch(function (error) {
        console.error('SectorService: trails could not be read, the name lists are used.', error);
        trailsCache = null;
        return [];
      });
    }
    return trailsCache;
  }

  /** The visible trails of a sector, by name: [{ id, name, number, kind }]. */
  function itemsOf(sector, trails) {
    var ids = [sector.id].concat(sector.aliases);
    return trails
      .filter(function (t) {
        return t.archived !== true && t.sector && ids.indexOf(t.sector) !== -1 && Network.of(t) === sector.network;
      })
      .map(function (t) { return { id: t.id, name: t.name || t.id, number: t.number, kind: t.kind || (t.network === 'bike' ? 'bike' : 'uphill') }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
  }

  /**
   * The sectors of one network; by default the current activity's (Network.current()).
   * Each has `items`: its trail records (see itemsOf).
   */
  async function load(network) {
    // APP_CONFIG / Network are global consts: visible as bare names, not as window.X
    var wanted = network || Network.current() || APP_CONFIG.defaultNetworks[0];
    var results = await Promise.all([loadAll(), loadTrails()]);
    return results[0]
      .filter(function (s) { return s.network === wanted; })
      .map(function (s) { return Object.assign({}, s, { items: itemsOf(s, results[1]) }); });
  }

  /** The sector for an id or one of its aliases, or null. */
  function find(sectors, idOrAlias) {
    if (!idOrAlias) return null;
    return sectors.find(function (s) { return s.id === idOrAlias; }) ||
      sectors.find(function (s) { return s.aliases.indexOf(idOrAlias) !== -1; }) ||
      null;
  }

  /** Display name for a sector id, falling back to what the record stored. */
  function nameOf(sectors, idOrAlias, fallback) {
    var sector = find(sectors, idOrAlias);
    return sector ? sector.name : (fallback || idOrAlias || '-');
  }

  /** Fills a <select> with the sectors (value = sector id). */
  function fillSectors(select, sectors, placeholder) {
    select.replaceChildren.apply(select, [new Option(placeholder, '')].concat(
      sectors.map(function (s) { return new Option(s.name, s.id); })
    ));
  }

  /**
   * Fills a <select> with a sector's trails (value = trail id, the number is added only when two
   * names would look the same). kind (optional): one kind, or an array of kinds - only those
   * trails. The inspection and signalisation apps use this to offer only the view currently
   * shown (Kind.current(); signalisations pass TrailService.viewKinds(), as Descente covers
   * downhill and lift); infractions leave it out, since they are for every kind together.
   */
  function fillTrails(select, sector, placeholder, kind) {
    var options = [new Option(placeholder, '')];
    var items = sector && sector.items ? sector.items : [];
    if (kind) {
      var kinds = [].concat(kind);
      items = items.filter(function (i) { return kinds.indexOf(i.kind) !== -1; });
    }
    var seen = {};
    items.forEach(function (i) { var k = norm(i.name); seen[k] = (seen[k] || 0) + 1; });
    items.forEach(function (i) {
      var clash = seen[norm(i.name)] > 1;
      var label = clash ? i.name + ' (' + (i.number != null && i.number !== '' ? i.number : i.kind) + ')' : i.name;
      var option = new Option(label, i.id);
      option.dataset.trailId = i.id;
      option.dataset.name = i.name;
      options.push(option);
    });
    select.replaceChildren.apply(select, options);
  }

  /**
   * The kind of trail a report is about, or null when it cannot be told: by its trailId (any trail
   * record, even a hidden one), else by its name within its sector (old reports that only kept
   * the name). `trails` is loadTrails().
   */
  function kindOfReport(sectors, trails, report) {
    var kindOf = function (t) { return t.kind || (t.network === 'bike' ? 'bike' : 'uphill'); };
    var byId = report.trailId && trails.filter(function (t) { return t.id === report.trailId; })[0];
    if (byId) return kindOf(byId);
    var sector = find(sectors, report.sector);
    var wanted = norm(report.trail);
    var byName = sector && wanted && sector.items.filter(function (i) { return norm(i.name) === wanted; })[0];
    return byName ? byName.kind : null;
  }

  /**
   * The reports that belong to the given kinds (an array, or null = all). A report whose kind
   * cannot be told (old report, its trail no longer exists) is kept: it must never disappear.
   */
  function inKinds(sectors, trails, reports, kinds) {
    if (!kinds) return reports;
    return reports.filter(function (r) {
      var kind = kindOfReport(sectors, trails, r);
      return !kind || kinds.indexOf(kind) !== -1;
    });
  }

  /** The sectors holding at least one trail of the given kinds (an array, or null = all). */
  function withKinds(sectors, kinds) {
    if (!kinds) return sectors;
    return sectors.filter(function (s) { return s.items.some(function (i) { return kinds.indexOf(i.kind) !== -1; }); });
  }

  /** What is picked in a trail <select>: { id, name }. id is null for a name-only (old) report. */
  function readTrail(select) {
    var option = select.selectedOptions && select.selectedOptions[0];
    if (!option || !option.value) return { id: null, name: null };
    return { id: option.dataset.trailId || null, name: option.dataset.name || option.value };
  }

  /**
   * Selects a record's trail: by its trail id when it has one, else by name (accents and case
   * ignored). A trail that is not in the list any more (renamed, hidden, removed) is kept as an
   * extra option so editing the record does not silently drop it.
   */
  function selectTrail(select, name, trailId) {
    var options = Array.prototype.slice.call(select.options);
    var found = null;
    if (trailId) found = options.filter(function (o) { return o.dataset.trailId === trailId; })[0];
    if (!found && name) found = options.filter(function (o) { return o.value && norm(o.dataset.name || o.value) === norm(name); })[0];
    if (found) { select.value = found.value; return; }
    if (name) {
      var extra = new Option(name + ' (ancienne piste)', 'legacy:' + name);
      extra.dataset.name = name;
      select.appendChild(extra);
      select.value = extra.value;
    } else {
      select.value = '';
    }
  }

  /**
   * Selects a record's sector in a <select> filled by fillSectors(). An old
   * alias selects its current sector; an id that no longer exists is kept as
   * an extra option so editing the record does not silently drop it.
   * Returns the sector (or null).
   */
  function selectSector(select, sectors, idOrAlias) {
    var sector = find(sectors, idOrAlias);
    if (sector) {
      select.value = sector.id;
    } else if (idOrAlias) {
      select.appendChild(new Option(idOrAlias + ' (secteur inconnu)', idOrAlias));
      select.value = idOrAlias;
    } else {
      select.value = '';
    }
    return sector;
  }

  global.SectorService = {
    norm: norm,
    loadAll: loadAll,
    loadTrails: loadTrails,
    load: load,
    find: find,
    nameOf: nameOf,
    fillSectors: fillSectors,
    fillTrails: fillTrails,
    kindOfReport: kindOfReport,
    inKinds: inKinds,
    withKinds: withKinds,
    readTrail: readTrail,
    selectSector: selectSector,
    selectTrail: selectTrail
  };

})(typeof window !== 'undefined' ? window : this);
