/**
 * inspection-gaps.js - "À inspecter": the trails not inspected for a while
 * =========================================================================
 * The list at the end of the Inspections dashboard (pages/inspection-dashboard.html). No new reading: the dashboard already holds the
 * latest inspection of every trail of the season, this only sorts them by how long ago it was.
 *
 *   InspectionGaps.enabledFor('ski', 'uphill')            -> true (APP_CONFIG.networks.<id>.staleKinds: uphill only for now, add 'downhill' to turn it on)
 *   InspectionGaps.build(trails, lastByTrail, { now, days })
 *        -> { late: [{ trail, last, days }], total, upToDate }   late = no inspection this season (days: null, first) then the longest ago first
 *   await InspectionGaps.loadDays(db, 'ski')              -> 7 (the limit set by an admin, else the default)
 *   await InspectionGaps.saveDays(db, 'ski', 5, user)     -> writes inspection_settings/config { staleDays: { ski: 5 } }
 *
 * The limit is per activity. A day counts as a calendar day (an inspection yesterday evening = 1 day ago, whatever the hour).
 */
const InspectionGaps = (function () {
  'use strict';

  const DEFAULT_DAYS = 7, MIN_DAYS = 1, MAX_DAYS = 60;
  const SETTINGS = ['inspection_settings', 'config'];

  const toDate = v => (v ? (v.toDate ? v.toDate() : new Date(v)) : null);
  const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysBetween = (from, to) => Math.round((dayStart(to) - dayStart(from)) / 86400000);

  /** Is the list on for this kind of trail (config: staleKinds)? */
  function enabledFor(networkId, kind) {
    const net = APP_CONFIG.networks[networkId];
    return !!(net && Array.isArray(net.staleKinds) && net.staleKinds.includes(kind));
  }

  /** A usable limit (a whole number of days, 1 to 60) or null. */
  function cleanDays(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= MIN_DAYS && n <= MAX_DAYS ? n : null;
  }

  /**
   * trails: the trails to check. lastByTrail: { trailId: inspection } (the latest of the season; `date` a Timestamp or a Date).
   * A trail with a last inspection of fewer than `days` days ago is up to date.
   */
  function build(trails, lastByTrail, options) {
    const o = options || {};
    const now = o.now || new Date();
    const limit = cleanDays(o.days) || DEFAULT_DAYS;
    const late = [];
    (trails || []).forEach(trail => {
      const insp = lastByTrail && lastByTrail[trail.id];
      const last = insp ? toDate(insp.date) : null;
      if (!last || isNaN(last)) { late.push({ trail, last: null, days: null }); return; }
      const days = Math.max(0, daysBetween(last, now));
      if (days >= limit) late.push({ trail, last, days });
    });
    late.sort((a, b) => {
      if ((a.days === null) !== (b.days === null)) return a.days === null ? -1 : 1;   // never inspected this season first
      return (b.days || 0) - (a.days || 0) || String(a.trail.name || '').localeCompare(String(b.trail.name || ''), 'fr');
    });
    const total = (trails || []).length;
    return { late, total, upToDate: total - late.length, limit };
  }

  /** The limit set by an admin for this activity (the default when none, or when it cannot be read). */
  async function loadDays(db, networkId) {
    try {
      const snap = await db.collection(SETTINGS[0]).doc(SETTINGS[1]).get();
      const data = snap && snap.exists ? snap.data() : null;
      return cleanDays(data && data.staleDays && data.staleDays[networkId]) || DEFAULT_DAYS;
    } catch (e) { return DEFAULT_DAYS; }
  }

  /** Saves the limit of one activity (the other activity's limit is kept). Returns the saved number; throws if it is not 1 to 60. */
  async function saveDays(db, networkId, value, user) {
    const days = cleanDays(value);
    if (!days) throw new Error(`La limite doit être un nombre de jours entre ${MIN_DAYS} et ${MAX_DAYS}.`);
    await db.collection(SETTINGS[0]).doc(SETTINGS[1]).set({
      staleDays: { [networkId]: days },
      updatedBy: (user && user.uid) || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return days;
  }

  return { enabledFor, build, loadDays, saveDays, cleanDays, DEFAULT_DAYS, MIN_DAYS, MAX_DAYS };
})();
if (typeof window !== 'undefined') window.InspectionGaps = InspectionGaps;
