/**
 * trail-service.js - What a trail is, and how it is labelled
 * ==========================================================
 * One place for the trail vocabulary the apps share: kind (uphill / downhill / bike),
 * difficulty (a scale per kind), status (open / closed), inspection condition, and
 * the text shown for a trail in lists and pickers. The values and labels themselves live
 * in APP_CONFIG (trailKinds, difficulties, difficultyScales, labels).
 *
 * A trail without a `kind` is read as 'bike' in the bike network, else 'uphill' (a safe default).
 *
 * Requires config.js (APP_CONFIG) and network.js (Network).
 */
const TrailService = (function () {
  'use strict';

  /** 'uphill' | 'downhill' | 'bike' */
  function kindOf(trail) {
    if (trail && APP_CONFIG.trailKinds[trail.kind]) return trail.kind;
    return trail && trail.network === 'bike' ? 'bike' : 'uphill';
  }

  function kindLabel(kind) {
    const k = APP_CONFIG.trailKinds[kind];
    return k ? k.label : String(kind || '');
  }

  /** The difficulty ids a kind of trail can have, easiest first. */
  function scaleOf(kind) {
    return (APP_CONFIG.difficultyScales[kind] || []).slice();
  }

  /** 'green' | 'blue' | 'black' | 'double-black', or null when not set or unknown. */
  function difficultyOf(trail) {
    const raw = trail && trail.difficulty;
    return APP_CONFIG.difficulties[raw] ? raw : null;
  }

  function difficultyLabel(id, withIcon) {
    const d = APP_CONFIG.difficulties[id];
    if (!d) return '';
    return withIcon ? `${d.icon} ${d.label}` : d.label;
  }

  /** Is this trail inspected (and shown on the public status page) in the given activity? */
  function isInspected(trail, networkId) {
    const network = APP_CONFIG.networks[networkId || Network.current()];
    return !!network && network.inspectionKinds.includes(kindOf(trail));
  }

  /** Hidden trail: no longer part of the network, kept for the history. */
  function isArchived(trail) {
    return !!trail && trail.archived === true;
  }

  /**
   * A trail that is part of the network today and is inspected: what the inspection apps and
   * the public status page show. (Inspection history keeps archived trails: use isInspected.)
   */
  function isActive(trail, networkId) {
    return !isArchived(trail) && isInspected(trail, networkId);
  }

  /** The id of the map (APP_CONFIG.maps) that a kind of trail, or a trail, is placed on. */
  function mapIdOf(kindOrTrail) {
    const kind = typeof kindOrTrail === 'string' ? kindOrTrail : kindOf(kindOrTrail);
    return (APP_CONFIG.trailKinds[kind] || {}).map || null;
  }

  /**
   * The kinds of the current activity that share a map with `kind` - what one view of the header
   * Montée / Descente switch covers. Ski: uphill alone on the touring map; downhill AND lift on
   * the downhill map. Bike: just bike.
   */
  function kindsInView(kind, networkId) {
    const network = APP_CONFIG.networks[networkId || Network.current()];
    const map = mapIdOf(kind);
    return ((network && network.trailKinds) || []).filter(k => mapIdOf(k) === map);
  }

  /** The kinds of the view currently selected in the header switch (Kind.current()), or null when there is no switch. */
  function viewKinds() {
    const kind = typeof Kind !== 'undefined' ? Kind.current() : null;
    return kind ? kindsInView(kind) : null;
  }

  /**
   * The id of the map (APP_CONFIG.maps) that a kind of trail's GPS-derived photo pins are placed
   * on (inspection dashboard/history) - a kind can use a separate, GPS-calibrated map for this
   * from the one its status markers are placed on (trailKinds.<kind>.geoMap), falling back to
   * mapIdOf when it has none.
   */
  function geoMapIdOf(kindOrTrail) {
    const kind = typeof kindOrTrail === 'string' ? kindOrTrail : kindOf(kindOrTrail);
    const conf = APP_CONFIG.trailKinds[kind] || {};
    return conf.geoMap || conf.map || null;
  }

  /** The checklist of common issues (APP_CONFIG.trailKinds.<kind>.issues) for a kind of trail, or a trail. */
  function issuesOf(kindOrTrail) {
    const kind = typeof kindOrTrail === 'string' ? kindOrTrail : kindOf(kindOrTrail);
    return ((APP_CONFIG.trailKinds[kind] || {}).issues || []).slice();
  }

  /** 'open' | 'closed' | 'unknown' */
  function statusOf(trail) {
    return trail && (trail.status === 'open' || trail.status === 'closed') ? trail.status : 'unknown';
  }

  /** 'piste' | 'sousbois' | 'parc' for a downhill trail (Piste when not set), null for the other kinds */
  function trailTypeOf(trail) {
    if (!trail || kindOf(trail) !== 'downhill') return null;
    return APP_CONFIG.trailTypes[trail.trailType] ? trail.trailType : 'piste';
  }

  /** 'remontee' | 'tapis' for a lift (Remontée when not set), null for the other kinds */
  function liftTypeOf(trail) {
    if (!trail || kindOf(trail) !== 'lift') return null;
    return APP_CONFIG.liftTypes[trail.liftType] ? trail.liftType : 'remontee';
  }

  /** The words for the type of a downhill trail or a lift ('Sous-bois', 'Tapis magique'), '' for the other kinds */
  function typeLabel(trail) {
    const t = trailTypeOf(trail);
    if (t) return APP_CONFIG.trailTypes[t].label;
    const l = liftTypeOf(trail);
    return l ? APP_CONFIG.liftTypes[l].label : '';
  }

  /** The surface of a downhill trail in acres (0 when not set) */
  function surfaceOf(trail) {
    const n = trail ? Number(trail.surfaceAcres) : 0;
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** 'groomed' | 'progressive' for a downhill trail that is open with a sub-state, else null (plain Ouvert, closed, other kinds) */
  function openModeOf(trail) {
    if (!trail || trail.status !== 'open' || kindOf(trail) !== 'downhill') return null;
    return APP_CONFIG.openModes[trail.openMode] ? trail.openMode : null;
  }

  /** The words of the status of a trail: "Ouvert", "Ouvert damé", "Ouverture progressive", "Fermé", "Inconnu" */
  function statusWord(trail) {
    const mode = openModeOf(trail);
    return mode ? APP_CONFIG.openModes[mode].label : statusText(statusOf(trail));
  }

  /** The comment left with the last status change of a trail (free text), '' when none */
  function noteOf(trail) {
    return trail && typeof trail.note === 'string' ? trail.note.trim() : '';
  }

  function statusText(status, withIcon) {
    const s = APP_CONFIG.labels.trailStatus[status] || APP_CONFIG.labels.trailStatus.unknown;
    return withIcon ? `${s.icon} ${s.label}` : s.label;
  }

  function conditionText(condition, withIcon) {
    const c = APP_CONFIG.labels.condition[condition] || APP_CONFIG.labels.condition.unknown;
    return withIcon ? `${c.icon} ${c.label}` : c.label;
  }

  function conditionIcon(condition) {
    return (APP_CONFIG.labels.condition[condition] || APP_CONFIG.labels.condition.unknown).icon;
  }

  /** Marker label: the trail's number if it has one, else its id without the prefix (trail_3, bike_3 -> 3). */
  function markerLabel(trail) {
    return trail.number != null && trail.number !== '' ? String(trail.number) : String(trail.id || '').replace(/^[a-z]+_/, '');
  }

  /** "Le Campagnol (Bleue · 1.1 km)": the name, then what is known (both are optional). */
  function describe(trail) {
    const extra = [difficultyLabel(difficultyOf(trail)), trail.length != null && trail.length !== '' ? `${trail.length} km` : '']
      .filter(Boolean).join(' · ');
    return extra ? `${trail.name} (${extra})` : `${trail.name}`;
  }

  /** Sort by number (numeric, numbered trails first), then by name. */
  function compare(a, b) {
    const na = a.number != null && a.number !== '' ? String(a.number) : null;
    const nb = b.number != null && b.number !== '' ? String(b.number) : null;
    if (na !== null && nb !== null) {
      const byNumber = na.localeCompare(nb, 'fr', { numeric: true });
      if (byNumber) return byNumber;
    } else if (na !== null || nb !== null) {
      return na !== null ? -1 : 1;
    }
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  }

  /** The id for a new trail of a kind: trail_12, run_1, bike_3 (one more than the highest in use). */
  function nextId(kind, existingIds) {
    const prefix = (APP_CONFIG.trailKinds[kind] || {}).idPrefix || kind;
    const used = existingIds
      .filter(id => id.startsWith(prefix + '_'))
      .map(id => parseInt(id.slice(prefix.length + 1), 10))
      .filter(n => !isNaN(n));
    return `${prefix}_${Math.max(0, ...used) + 1}`;
  }

  return { kindOf, kindLabel, scaleOf, difficultyOf, difficultyLabel, isInspected, isArchived, isActive, mapIdOf, kindsInView, viewKinds, geoMapIdOf, issuesOf, statusOf, trailTypeOf, liftTypeOf, typeLabel, surfaceOf, openModeOf, statusWord, noteOf, statusText, conditionText, conditionIcon, markerLabel, describe, compare, nextId };
})();
window.TrailService = TrailService;
