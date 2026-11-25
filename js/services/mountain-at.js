/**
 * MountainAt - what the mountain looked like at a given date and time (Régis gère > À une date).
 * ==============================================================================================
 * The status log (collection status_log, see status-service.js) says who changed what and when, never edited, never deleted, so the state of
 * every trail at any moment is rebuilt from it:
 *
 *   MountainAt.relevant(lines)                  the lines that changed a state: action 'status' or 'detail' ('ignore' lines change nothing)
 *   MountainAt.reconstruct(trails, before, after, at)
 *        trails   the trails as they are today (types, surfaces, sectors are today's: they are not in the log)
 *        before   the log lines up to `at` (any order), after: the lines after `at` (any order; only used for a trail with none before)
 *        at       a Date
 *      -> [{ ...trail, status, openMode, note, how }] with how = 'log' (the last change up to then), 'before' (no change yet at that
 *         moment: the state is what the first LATER change started from) or 'current' (the log never mentions it: today's state is kept).
 *      A trail created after `at` is left out. A comment (note) comes back only for a downhill trail changed one at a time: the log keeps a
 *      sector or mountain action's reason ("Secteur ouvert en batch"), which was never a comment of the trail.
 *   MountainAt.weatherAt(records, at)           the latest reading recorded up to `at`, and how long before: { record, ageMs } or null
 *   MountainAt.firstLine(lines)                 the date of the oldest line (a Date), or null: before it the log knows nothing
 *
 * No Firebase in here: the page reads the collections and passes the lines in (tests/specs/mountain-at.html).
 */
const MountainAt = (() => {
  'use strict';
  const ms = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && typeof t.toDate === 'function') ? t.toDate().getTime() : (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : null));

  const relevant = lines => (lines || []).filter(l => l && (l.action === 'status' || l.action === 'detail') && l.trailId && ms(l.at) !== null);

  const clean = (status) => (status === 'open' || status === 'closed') ? status : 'unknown';
  const mode = v => (v === 'groomed' || v === 'progressive') ? v : null;

  function reconstruct(trails, before, after, at) {
    const t = at instanceof Date ? at.getTime() : Number(at);
    const last = new Map(), first = new Map();
    relevant(before).forEach(l => { if (ms(l.at) <= t) { const o = last.get(l.trailId); if (!o || ms(l.at) >= ms(o.at)) last.set(l.trailId, l); } });
    relevant(after).forEach(l => { if (ms(l.at) > t) { const o = first.get(l.trailId); if (!o || ms(l.at) < ms(o.at)) first.set(l.trailId, l); } });
    const out = [];
    (trails || []).forEach(tr => {
      const created = ms(tr.createdAt);
      if (created !== null && created > t) return;   // it did not exist yet
      const l = last.get(tr.id), f = first.get(tr.id);
      const copy = Object.assign({}, tr);
      if (l) {
        copy.status = clean(l.to);
        copy.openMode = copy.status === 'open' ? mode(l.openMode) : null;
        // only a downhill trail has a comment; the reason of a lift's change (Météo: "Vent faible") or of a sector action is not one
        copy.note = (tr.kind === 'downhill' && l.mode === 'individual' && l.reason) ? String(l.reason) : '';
        copy.how = 'log';
      } else if (f) {
        copy.status = clean(f.from);
        copy.openMode = copy.status === 'open' ? mode(f.fromOpenMode) : null;
        copy.note = '';
        copy.how = 'before';
      } else {
        copy.openMode = tr.openMode || null;
        copy.note = '';
        copy.how = 'current';
      }
      out.push(copy);
    });
    return out;
  }

  function weatherAt(records, at) {
    const t = at instanceof Date ? at.getTime() : Number(at);
    let best = null;
    (records || []).forEach(r => {
      const m = ms(r.recordedAt);
      if (m === null || m > t) return;
      if (!best || m > best.ms) best = { record: r, ms: m };
    });
    return best ? { record: best.record, ageMs: t - best.ms } : null;
  }

  function firstLine(lines) {
    let min = null;
    relevant(lines).forEach(l => { const m = ms(l.at); if (min === null || m < min) min = m; });
    return min === null ? null : new Date(min);
  }

  return { relevant, reconstruct, weatherAt, firstLine };
})();
if (typeof window !== 'undefined') window.MountainAt = MountainAt;
