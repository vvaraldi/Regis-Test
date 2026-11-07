/**
 * badges.js - the inspector's medal of the season (shown on the Inspections tile of the portal)
 * ==============================================================================================
 * Counts the inspections (trails and shelters) made by a person since the start of the season of the activity, and turns the number
 * into a level: 5, 10, 20, 50 and 100 inspections. It starts again at 0 with each season (ski: 1 Nov, bike: 1 May) because only
 * the inspections of the season are counted: nothing is stored, nothing to reset.
 *
 *   const s = await Badges.summary(db, uid, 'ski');   // { count, level, next, remaining, range }
 *   Badges.forget();                                   // after a report is saved: the next summary counts again
 *
 * One trail (or shelter) counts ONCE per day, so sending the same inspection twice, or inspecting a trail again in the afternoon,
 * does not add a point. The reading is the person's own inspections of the season (a few dozen documents), kept for 10 minutes in the
 * session so opening the portal again and again costs nothing. It needs the Firestore index "inspector_id + date" on trail_inspections
 * and shelter_inspections (see BADGES_SETUP.md): without it the medal is simply not shown.
 */
const Badges = (function () {
  'use strict';

  const LEVELS = [
    { at: 5,   id: 'bronze',  icon: '🥉', name: 'Éclaireur' },
    { at: 10,  id: 'argent',  icon: '🥈', name: 'Patrouilleur' },
    { at: 20,  id: 'or',      icon: '🥇', name: 'Sentinelle' },
    { at: 50,  id: 'gardien', icon: '🏅', name: 'Gardien du Mont' },
    { at: 100, id: 'legende', icon: '🏆', name: 'Légende d’Orford' }
  ];
  const CACHE_PREFIX = 'regis-badge:';
  const CACHE_MS = 10 * 60 * 1000;

  const toDate = v => (v ? (v.toDate ? v.toDate() : new Date(v)) : null);
  const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const tryDo = fn => { try { return fn(); } catch (e) { return undefined; } };

  /** The highest level reached with this many inspections (null before the first one). */
  function levelFor(count) {
    let found = null;
    LEVELS.forEach(l => { if (count >= l.at) found = l; });
    return found;
  }
  /** The next level to reach (null once the last one is reached). */
  function nextFor(count) { return LEVELS.find(l => l.at > count) || null; }

  /** The number of inspections of a list of documents, one per trail (or shelter) and day, inside the season, of this activity. */
  function countDocs(docs, range, networkId) {
    const seen = new Set();
    docs.forEach(d => {
      // The query reads all of the person's inspections since the start of the season, whatever the activity: keep this activity's only
      // (a ski inspection made in July must not count in the bike season)
      if (networkId && d.network !== networkId) return;
      const when = toDate(d.date);
      if (!when || isNaN(when) || when < range.start || when > range.end) return;
      const place = d.trail_id || d.shelter_id;
      if (!place) return;
      seen.add(`${place}|${dayKey(when)}`);
    });
    return seen.size;
  }

  async function ownInspections(db, collection, uid, range) {
    const snap = await db.collection(collection)
      .where('inspector_id', '==', uid)
      .where('date', '>=', firebase.firestore.Timestamp.fromDate(range.start)).get();
    const rows = [];
    snap.forEach(doc => rows.push(doc.data()));
    return rows;
  }

  function cacheKey(uid, networkId, range) { return `${CACHE_PREFIX}${uid}:${networkId}:${range.start.getTime()}`; }

  /** { count, level, next, remaining, range } for one person in one activity, or null when it cannot be counted. */
  async function summary(db, uid, networkId) {
    if (!uid) return null;
    const range = Network.seasonRange(networkId);
    const key = cacheKey(uid, networkId, range);
    let count = null;
    const cached = tryDo(() => JSON.parse(sessionStorage.getItem(key)));
    if (cached && typeof cached.count === 'number' && Date.now() - cached.at < CACHE_MS) count = cached.count;
    if (count === null) {
      try {
        const net = APP_CONFIG.networks[networkId];
        const lists = [await ownInspections(db, 'trail_inspections', uid, range)];
        if (net && net.features && net.features.shelters) lists.push(await ownInspections(db, 'shelter_inspections', uid, range));
        count = countDocs([].concat(...lists), range, networkId);
        tryDo(() => sessionStorage.setItem(key, JSON.stringify({ count, at: Date.now() })));
      } catch (e) {
        console.warn('Badges: the inspections could not be counted (is the index "inspector_id + date" created? see BADGES_SETUP.md).', e);
        return null;
      }
    }
    const next = nextFor(count);
    return { count, level: levelFor(count), next, remaining: next ? next.at - count : 0, range };
  }

  /** Forget the kept counts (a report was just saved). */
  function forget() {
    tryDo(() => Object.keys(sessionStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => sessionStorage.removeItem(k)));
  }

  /** The sentence for the tooltip of the medal. */
  function describe(s) {
    if (!s) return '';
    const plural = n => `${n} inspection${n > 1 ? 's' : ''}`;
    const head = s.level ? `${s.level.icon} ${s.level.name} - ` : '';
    const season = s.range && s.range.active ? 'cette saison' : 'la saison dernière';
    const tail = s.next ? ` Encore ${plural(s.remaining)} pour ${s.next.icon} ${s.next.name}.` : ' Niveau maximum atteint, bravo !';
    return `${head}${plural(s.count)} ${season}.${tail}`;
  }

  return { LEVELS, levelFor, nextFor, countDocs, summary, forget, describe };
})();
if (typeof window !== 'undefined') window.Badges = Badges;
