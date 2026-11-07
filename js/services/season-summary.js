/**
 * season-summary.js - the figures of the season summary ("Bilan de saison", tab of the Administration page, js/admin/season-summary-view.js)
 * =========================================================================================================
 * Pure calculation: the page reads the season's documents and hands them over; nothing here reads the database, so it is
 * tested with plain arrays (tests/specs/season-summary.html).
 *
 *   const s = SeasonSummary.compute({ range: {start, end}, now, trails, shelters, trailInspections, shelterInspections,
 *                                     statusLog, weather, maintenance });
 *   SeasonSummary.highlights(s)          -> [{ id, label, value, unit?, higherIsBetter? }] the key figures, to put next to the previous season
 *   SeasonSummary.bounds(offset)         -> { start, end, isCurrent, active } season 0 = the latest started, 1 = the one before...
 *
 * Every date may be a Firestore Timestamp (toDate) or a Date. A section whose list is null (not read) is null in the result.
 * Days are calendar days.
 */
const SeasonSummary = (function () {
  'use strict';

  const toDate = v => (v ? (v.toDate ? v.toDate() : new Date(v)) : null);
  const valid = d => d instanceof Date && !isNaN(d);
  const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 86400000);
  const round1 = n => Math.round(n * 10) / 10;
  const inRange = (d, range) => valid(d) && d >= range.start && d <= range.end;
  const top = (counts, n) => Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr')).slice(0, n);
  const bump = (obj, key, by) => { obj[key] = (obj[key] || 0) + (by === undefined ? 1 : by); };

  /** The season `offset` seasons back (0 = the latest started: running, or the one that just ended), for the current activity. */
  function bounds(offset) {
    const current = Network.seasonRange();
    const off = offset || 0;
    const isCurrent = off === 0;
    const start = new Date(current.start.getFullYear() - off, current.start.getMonth(), current.start.getDate());
    const seasonEnd = new Date(current.end.getFullYear() - off, current.end.getMonth(), current.end.getDate(), 23, 59, 59, 999);   // the season's own last day
    const end = isCurrent && current.active ? new Date(Network.now()) : new Date(seasonEnd);                                      // a running season is counted up to today
    end.setHours(23, 59, 59, 999);
    return { start, end, seasonEnd, isCurrent, active: isCurrent && current.active };
  }

  // ---- inspections ----
  function inspectionsPart(input, range) {
    const rows = [];
    (input.trailInspections || []).forEach(i => rows.push({ place: i.trail_id, kind: 'trail', i }));
    (input.shelterInspections || []).forEach(i => rows.push({ place: i.shelter_id, kind: 'shelter', i }));
    const inside = rows.map(r => Object.assign(r, { date: toDate(r.i.date) })).filter(r => inRange(r.date, range));
    const byMonth = {}, issues = {}, inspectors = {};
    let photos = 0, withIssues = 0;
    inside.forEach(r => {
      bump(byMonth, `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}`);
      photos += (r.i.photos || []).length;
      if ((r.i.issues || []).length) withIssues++;
      (r.i.issues || []).forEach(x => bump(issues, String(x)));
      bump(inspectors, r.i.inspector_name || r.i.inspector || r.i.inspector_id || 'Inconnu');
    });
    // every month of the season, even an empty one
    const months = [];
    for (let d = new Date(range.start.getFullYear(), range.start.getMonth(), 1); d <= range.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label: d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' }), count: byMonth[key] || 0 });
    }
    return {
      total: inside.length,
      trail: inside.filter(r => r.kind === 'trail').length,
      shelter: inside.filter(r => r.kind === 'shelter').length,
      photos, withIssues,
      withIssuesPct: inside.length ? Math.round(withIssues / inside.length * 100) : null,
      inspectors: Object.keys(inspectors).length,
      byMonth: months,
      topIssues: top(issues, 5),
      topInspectors: top(inspectors, 5),
      _rows: inside
    };
  }

  // ---- coverage: how well the trails were visited ----
  function coveragePart(input, range, now, inspections) {
    const trails = (input.trails || []);
    const byTrail = {};
    inspections._rows.filter(r => r.kind === 'trail').forEach(r => { (byTrail[r.place] = byTrail[r.place] || []).push(r.date); });
    const end = valid(now) && now < range.end ? now : range.end;
    const never = [];
    let inspectedOnce = 0, gapSum = 0, gapCount = 0, longest = null;
    trails.forEach(t => {
      const dates = (byTrail[t.id] || []).slice().sort((a, b) => a - b);
      if (!dates.length) { never.push(t.name || t.id); return; }
      inspectedOnce++;
      // the periods without inspection: from the start of the season to the first one, between two, and from the last one to the end (or today)
      // (the average counts only the gaps between two inspections; the longest period counts all of them)
      const marks = [range.start].concat(dates, [end]);
      for (let k = 1; k < marks.length; k++) {
        const gap = Math.max(0, daysBetween(marks[k - 1], marks[k]));
        if (k >= 2 && k <= dates.length) { gapSum += gap; gapCount++; }
        if (!longest || gap > longest.days) longest = { name: t.name || t.id, days: gap };
      }
    });
    return {
      trails: trails.length,
      inspectedOnce,
      pct: trails.length ? Math.round(inspectedOnce / trails.length * 100) : null,
      never: never.sort((a, b) => a.localeCompare(b, 'fr')),
      avgGapDays: gapCount ? round1(gapSum / gapCount) : null,
      longestGap: longest
    };
  }

  // ---- closures, from the status log ----
  function closuresPart(input, range, now) {
    if (!input.statusLog) return null;
    const lines = input.statusLog.map(l => Object.assign({}, l, { _at: toDate(l.at) })).filter(l => inRange(l._at, range)).sort((a, b) => a._at - b._at);
    const end = valid(now) && now < range.end ? now : range.end;
    const status = lines.filter(l => l.action === 'status');
    const perTrail = {};
    status.forEach(l => {
      const t = perTrail[l.trailId] = perTrail[l.trailId] || { name: l.trailName || l.trailId, closures: 0, closedDays: 0, closedSince: null, firstSeen: true };
      if (t.firstSeen) { t.firstSeen = false; if (l.from === 'closed') t.closedSince = range.start; }   // closed before the first change we know of
      if (l.to === 'closed') { t.closures++; if (!t.closedSince) t.closedSince = l._at; }
      else if (t.closedSince) { t.closedDays += (l._at - t.closedSince) / 86400000; t.closedSince = null; }
    });
    Object.values(perTrail).forEach(t => { if (t.closedSince) { t.closedDays += Math.max(0, (end - t.closedSince) / 86400000); t.closedSince = null; } });
    const rows = Object.values(perTrail).map(t => ({ name: t.name, closures: t.closures, closedDays: round1(t.closedDays) }));
    const accepted = lines.filter(l => l.decision === 'accepted').length, ignored = lines.filter(l => l.decision === 'ignored').length;
    return {
      changes: status.length,
      closures: status.filter(l => l.to === 'closed').length,
      openings: status.filter(l => l.to === 'open').length,
      accepted, ignored,
      acceptedPct: accepted + ignored ? Math.round(accepted / (accepted + ignored) * 100) : null,
      closedDays: round1(rows.reduce((s, r) => s + r.closedDays, 0)),
      topClosed: rows.filter(r => r.closedDays > 0 || r.closures > 0).sort((a, b) => b.closedDays - a.closedDays || b.closures - a.closures || a.name.localeCompare(b.name, 'fr')).slice(0, 5)
    };
  }

  // ---- weather (typed values of the readings) ----
  function weatherPart(input, range) {
    if (!input.weather) return null;
    const rows = input.weather.map(w => ({ at: toDate(w.recordedAt), m: w.manual || {} })).filter(w => inRange(w.at, range));
    const temps = rows.map(w => w.m.tempC).filter(v => typeof v === 'number');
    const depths = rows.map(w => w.m.snowDepthCm).filter(v => typeof v === 'number');
    // fresh snow: the highest reading of each day, added up (several readings a day must not count the same snow twice)
    const perDay = {};
    rows.forEach(w => { if (typeof w.m.newSnowCm === 'number') { const k = w.at.toDateString(); perDay[k] = Math.max(perDay[k] || 0, w.m.newSnowCm); } });
    return {
      readings: rows.length,
      days: new Set(rows.map(w => w.at.toDateString())).size,
      minTemp: temps.length ? Math.min(...temps) : null,
      maxTemp: temps.length ? Math.max(...temps) : null,
      newSnowCm: Math.round(Object.values(perDay).reduce((s, v) => s + v, 0)),
      maxDepthCm: depths.length ? Math.max(...depths) : null
    };
  }

  // ---- maintenance (Entretien, bike): counted in DAYS, as nobody clocks in ----
  const inSeason = (list, field, range) => list.filter(x => inRange(toDate(x[field]), range));
  function maintenancePart(input, range) {
    if (!input.maintenance) return null;
    const list = inSeason(input.maintenance.filter(x => x.archived !== true), 'date', range);
    const people = new Set();
    let personDays = 0;
    list.forEach(x => {
      const ids = [x.builderId].concat(x.supportBuilderIds || [], x.volunteerIds || []).filter(Boolean);
      ids.forEach(id => people.add(id));
      personDays += new Set(ids).size;   // one report = one day of work for each person named on it
    });
    return {
      reports: list.length,
      days: new Set(list.map(x => toDate(x.date).toDateString())).size,   // days with work done
      people: people.size,
      personDays
    };
  }

  function compute(input) {
    const range = input.range;
    const now = input.now || new Date();
    const inspections = inspectionsPart(input, range);
    const result = {
      range,
      inspections,
      coverage: coveragePart(input, range, now, inspections),
      closures: closuresPart(input, range, now),
      weather: weatherPart(input, range),
      maintenance: maintenancePart(input, range)
    };
    delete inspections._rows;
    return result;
  }

  /** The key figures, in the order shown. `higherIsBetter`: true / false / undefined (just a figure) for the arrow next to the previous season. */
  function highlights(s) {
    const rows = [];
    const add = (id, label, value, unit, higherIsBetter) => rows.push({ id, label, value: value === undefined ? null : value, unit: unit || '', higherIsBetter });
    add('inspections', 'Inspections', s.inspections.total, '', true);
    add('withIssues', 'Inspections avec problèmes', s.inspections.withIssuesPct, ' %');
    add('inspectors', 'Inspecteurs actifs', s.inspections.inspectors, '', true);
    add('coverage', 'Sentiers inspectés au moins une fois', s.coverage.pct, ' %', true);
    add('avgGap', 'Jours entre deux inspections (moyenne)', s.coverage.avgGapDays, ' j', false);
    if (s.closures) {
      add('closures', 'Fermetures', s.closures.closures);
      add('closedDays', 'Jours de fermeture (total des sentiers)', s.closures.closedDays, ' j', false);
      add('accepted', 'Recommandations acceptées', s.closures.acceptedPct, ' %');
    }
    if (s.weather) add('snow', 'Neige fraîche cumulée', s.weather.newSnowCm, ' cm');
    if (s.maintenance) {
      add('maintenance', 'Jours d’entretien', s.maintenance.days, '', true);
      add('personDays', 'Jours de travail (total des personnes)', s.maintenance.personDays, '', true);
    }
    return rows;
  }

  return { compute, highlights, bounds };
})();
if (typeof window !== 'undefined') window.SeasonSummary = SeasonSummary;
