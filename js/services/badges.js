/**
 * badges.js - the inspector's medal of the season (shown on the Inspections tile of the portal and on the profile page)
 * =====================================================================================================================
 * Counts the inspections (trails and shelters) made by a person in a season of an activity (ski: 1 Nov - 30 Apr, bike: 1 May - 31 Oct)
 * and turns the number into a level: 5, 10, 20, 50 and 100 inspections. Each season starts again at 0.
 *
 *   const s = await Badges.summary(db, uid, 'ski', { userData });   // { count, level, next, remaining, range }
 *   const list = await Badges.seasons(db, uid, ['ski', 'bike'], { userData });   // the latest season and the one before, per activity
 *   Badges.forget();                                   // after a report is saved: the next summary counts again
 *
 * One trail (or shelter) counts ONCE per day, so sending the same inspection twice, or inspecting a trail again in the afternoon,
 * does not add a point. Only the inspections of the activity count (an inspection without activity is a ski one: the app was ski-only).
 * WHAT counts is set per activity in js/core/config.js (networks.<id>.medal = { kinds: [...], shelters: true|false }): in winter only the UPHILL
 * trails (no downhill, no shelters); the bike activity has no such line, so every trail inspection counts. The kind of a trail is read from the
 * trails (an inspection does not store it; a trail that cannot be found counts as the default kind of the activity). The stored medals carry the
 * rule they were counted with (`rule`): when the rule changes, they are counted again from the inspections, once.
 *
 * STORED in the person's profile (inspectors/{uid}.medals), so the inspections are not counted again and again:
 *   medals.ski_2026 = { count, upTo, recent: [place|day, ...], final }
 *   - count   the points so far;  upTo  the date (ms) of the latest inspection counted;
 *   - recent  the place|day keys of the last 7 days before upTo: the next reading starts 7 days before upTo, so it only reads the
 *             last week (not the whole season) and an inspection filed late, for a day up to a week back, is still counted once;
 *   - final   true once the season is over: nothing is read any more, the count is the medal of that season for good.
 * An inspection deleted later is NOT taken off the count. If the profile cannot be read or written (rules not published yet) the count
 * is simply computed from the inspections each time, as before. It needs the Firestore index "inspector_id + date" on trail_inspections
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
  const WINDOW_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const toDate = v => (v ? (v.toDate ? v.toDate() : new Date(v)) : null);
  const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const startOfDay = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const dayOfKey = k => { const p = String(k).split('|').pop().split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime(); };
  const tryDo = fn => { try { return fn(); } catch (e) { return undefined; } };

  /** The highest level reached with this many inspections (null before the first one). */
  function levelFor(count) {
    let found = null;
    LEVELS.forEach(l => { if (count >= l.at) found = l; });
    return found;
  }
  /** The next level to reach (null once the last one is reached). */
  function nextFor(count) { return LEVELS.find(l => l.at > count) || null; }

  /** What counts for an activity (config: networks.<id>.medal): { kinds: [...] | null, shelters: bool }. */
  function ruleFilter(networkId) {
    const m = (APP_CONFIG.networks[networkId] || {}).medal || {};
    return { kinds: Array.isArray(m.kinds) && m.kinds.length ? m.kinds.slice() : null, shelters: m.shelters !== false };
  }
  /** The rule as a short text, stored with a medal so that a changed rule is noticed. */
  function ruleOf(networkId) {
    const f = ruleFilter(networkId);
    return (f.kinds ? f.kinds.join('+') : 'all') + (f.shelters ? '+shelters' : '');
  }

  /** place|day -> date of the inspection, for the documents of this activity inside the season (one entry per trail or shelter and day). */
  function keysOf(docs, range, networkId, filter) {
    const found = new Map();
    docs.forEach(d => {
      // The query reads all of the person's inspections of the period, whatever the activity: keep this activity's only
      // (a ski inspection made in July must not count in the bike season). No activity written = ski (before the bike activity existed).
      if (networkId && (d.network || 'ski') !== networkId) return;
      const when = toDate(d.date);
      if (!when || isNaN(when) || when < range.start || when > range.end) return;
      const place = d.trail_id || d.shelter_id;
      if (!place) return;
      if (filter) {
        if (!d.trail_id) { if (filter.shelters === false) return; }   // a shelter inspection
        else if (filter.kinds && filter.kindOf) {
          const kind = filter.kindOf[d.trail_id] || (networkId === 'bike' ? 'bike' : 'uphill');   // a trail that cannot be found: the default kind
          if (!filter.kinds.includes(kind)) return;
        }
      }
      const key = `${place}|${dayKey(when)}`;
      if (!found.has(key) || when > found.get(key)) found.set(key, when);
    });
    return found;
  }

  /** The number of inspections of a list of documents, one per trail (or shelter) and day, inside the season, of this activity. */
  function countDocs(docs, range, networkId, filter) { return keysOf(docs, range, networkId, filter).size; }

  /** The stored entry brought up to date with the documents read (new place|day keys are added once). */
  function advance(entry, docs, range, networkId, filter) {
    const base = entry || { count: 0, upTo: null, recent: [] };
    const known = new Set(base.recent || []);
    let count = base.count || 0, upTo = typeof base.upTo === 'number' ? base.upTo : null;
    keysOf(docs, range, networkId, filter).forEach((when, key) => {
      if (!known.has(key)) { known.add(key); count++; }
      if (upTo === null || when.getTime() > upTo) upTo = when.getTime();
    });
    const from = upTo === null ? 0 : startOfDay(upTo) - WINDOW_DAYS * DAY_MS;
    const recent = [...known].filter(k => dayOfKey(k) >= from);
    return { count, upTo, recent, final: !!base.final };
  }

  async function ownInspections(db, collection, uid, from, range) {
    const snap = await db.collection(collection)
      .where('inspector_id', '==', uid)
      .where('date', '>=', firebase.firestore.Timestamp.fromDate(from))
      .where('date', '<=', firebase.firestore.Timestamp.fromDate(range.end)).get();
    const rows = [];
    snap.forEach(doc => rows.push(doc.data()));
    return rows;
  }

  /** trail id -> kind, for the activities whose medal depends on the kind of trail (kept an hour in the session); null when every trail counts. */
  async function trailKinds(db, networkId) {
    const f = ruleFilter(networkId);
    if (!f.kinds) return null;
    const ckey = 'regis-badge-kinds:' + networkId;
    const cached = tryDo(() => JSON.parse(sessionStorage.getItem(ckey)));
    if (cached && cached.map && Date.now() - cached.at < 60 * 60 * 1000) return cached.map;
    const snap = await db.collection('trails').where('network', '==', networkId).get();
    const map = {};
    snap.forEach(doc => { const t = doc.data(); map[doc.id] = t.kind && APP_CONFIG.trailKinds && APP_CONFIG.trailKinds[t.kind] ? t.kind : (t.network === 'bike' ? 'bike' : 'uphill'); });
    tryDo(() => sessionStorage.setItem(ckey, JSON.stringify({ at: Date.now(), map })));
    return map;
  }

  const seasonKey = (networkId, range) => `${networkId}_${range.start.getFullYear()}`;
  function cacheKey(uid, networkId, range) { return `${CACHE_PREFIX}${uid}:${networkId}:${range.start.getTime()}`; }

  /** The medals stored in the profile: the one given (the page has it already) or one read of the profile; {} if it cannot be read. */
  async function storedMedals(db, uid, opts) {
    if (opts && opts.userData) return opts.userData.medals || {};
    try {
      const snap = await db.collection('inspectors').doc(uid).get();
      const data = snap && snap.exists !== false && snap.data ? snap.data() : null;
      return (data && data.medals) || {};
    } catch (e) { return {}; }
  }

  /**
   * The count of one season of one activity: the stored one (final seasons: nothing is read), or the stored one plus what was
   * done since (the last week is read again), or - the first time - the whole season. The new state is stored in the profile.
   * Returns the count, or null when the inspections cannot be read.
   */
  async function seasonCount(db, uid, networkId, range, medals, opts) {
    const key = seasonKey(networkId, range);
    const rule = ruleOf(networkId);
    let entry = medals && medals[key];
    if (entry && entry.rule !== rule) entry = null;   // counted under another rule (e.g. downhill and shelters used to count): count again, once
    if (entry && entry.final && typeof entry.count === 'number') return entry.count;
    // kept 10 minutes in the session: opening the portal or the profile again and again reads nothing (forget() empties it after a save)
    const ckey = cacheKey(uid, networkId, range);
    const cached = tryDo(() => JSON.parse(sessionStorage.getItem(ckey)));
    if (cached && typeof cached.count === 'number' && Date.now() - cached.at < CACHE_MS) return cached.count;
    const net = APP_CONFIG.networks[networkId];
    const from = entry && typeof entry.upTo === 'number' ? new Date(Math.max(range.start.getTime(), startOfDay(entry.upTo) - WINDOW_DAYS * DAY_MS)) : range.start;
    let docs;
    const filter = ruleFilter(networkId);
    try {
      const lists = [await ownInspections(db, 'trail_inspections', uid, from, range)];
      if (net && net.features && net.features.shelters && filter.shelters) lists.push(await ownInspections(db, 'shelter_inspections', uid, from, range));
      docs = [].concat(...lists);
      filter.kindOf = await trailKinds(db, networkId);
    } catch (e) {
      console.warn('Badges: the inspections could not be counted (is the index "inspector_id + date" created? see BADGES_SETUP.md).', e);
      return null;
    }
    const next = advance(entry, docs, range, networkId, filter);
    next.rule = rule;
    if (!range.active) next.final = true;   // the season is over: this is its medal for good
    if (JSON.stringify(next) !== JSON.stringify(entry || null)) {
      if (opts && opts.userData) opts.userData.medals = Object.assign({}, opts.userData.medals, { [key]: next });
      try { await db.collection('inspectors').doc(uid).update({ ['medals.' + key]: next }); }
      catch (e) { console.warn('Badges: the medal could not be stored in the profile (rules not published yet?). It is counted again next time.', e); }
    }
    tryDo(() => sessionStorage.setItem(ckey, JSON.stringify({ count: next.count, at: Date.now() })));
    return next.count;
  }

  /** { count, level, next, remaining, range } for one person in one activity (its latest season), or null when it cannot be counted. */
  async function summary(db, uid, networkId, opts) {
    if (!uid) return null;
    const range = Network.seasonRange(networkId);
    const count = await seasonCount(db, uid, networkId, range, await storedMedals(db, uid, opts), opts);
    if (count === null) return null;
    const next = nextFor(count);
    return { count, level: levelFor(count), next, remaining: next ? next.at - count : 0, range };
  }

  /**
   * The medals of the latest season of each activity and of the season before it (the profile page): [{ networkId, range, count, level }],
   * newest first. A finished season is counted once and stored for good; the ones that cannot be counted are left out.
   */
  async function seasons(db, uid, networkIds, opts) {
    if (!uid) return [];
    const out = [];
    const medals = await storedMedals(db, uid, opts);
    for (const id of networkIds) {
      if (!APP_CONFIG.networks[id]) continue;
      const latest = Network.seasonRange(id);
      const before = Network.seasonRange(id, new Date(latest.start.getTime() - DAY_MS));
      for (const range of [latest, before]) {
        const count = await seasonCount(db, uid, id, range, medals, opts);
        if (count !== null) out.push({ networkId: id, range, count, level: levelFor(count) });
      }
    }
    return out.sort((a, b) => b.range.start - a.range.start || (a.networkId < b.networkId ? -1 : 1));
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
    const active = !!(s.range && s.range.active);
    const season = active ? 'cette saison' : 'dans la saison terminée';
    const tail = !active ? ' La nouvelle saison repart à zéro.' : (s.next ? ` Encore ${plural(s.remaining)} pour ${s.next.icon} ${s.next.name}.` : ' Niveau maximum atteint, bravo !');
    return `${head}${plural(s.count)} ${season}.${tail}`;
  }

  return { LEVELS, levelFor, nextFor, countDocs, advance, ruleOf, summary, seasons, forget, describe };
})();
if (typeof window !== 'undefined') window.Badges = Badges;
