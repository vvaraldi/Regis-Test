/**
 * PeriodFilter - the "Période" choice (same wording and rules as Inspections > Gestion) for the Signalisations pages:
 *   Toutes les saisons | Saison en cours | Aujourd'hui | 7 derniers jours | 30 derniers jours | Dates personnalisées
 *
 * A period state is { value: 'all' | 'season' | 'today' | 'week' | 'month' | 'custom', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 * (start / end only count for 'custom'; either may be empty = open ended; the end day is included).
 *
 *   PeriodFilter.matches(date, state)    does a date fall in the period? (no date: only "all" keeps it)
 *   PeriodFilter.lastChange(report)     the date a report is judged on: modifiedAt, else createdAt (a Date, or null)
 *   PeriodFilter.label(state)            the words for a printed list, e.g. "30 derniers jours", "du 1 oct. 2026 au 9 oct. 2026"
 *   PeriodFilter.toParams(state, params) / fromParams(params)   to pass the choice in a page address
 *   PeriodFilter.attach({ select, custom, start, end, onChange, seasonOption })  wires the controls of a page; returns { state(), reset() }
 *
 * The season is Network.seasonStart() (config: the activity's season), like Inspections.
 */
const PeriodFilter = (() => {
  const VALUES = ['all', 'season', 'today', 'week', 'month', 'custom'];
  const LABELS = { all: 'Toutes les saisons', season: 'Saison en cours', today: "Aujourd'hui", week: '7 derniers jours', month: '30 derniers jours', custom: 'Dates personnalisées' };
  const DAY = 24 * 60 * 60 * 1000;

  const day = text => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const normal = state => {
    const s = state || {};
    return { value: VALUES.includes(s.value) ? s.value : 'all', start: s.start || '', end: s.end || '' };
  };

  function matches(date, state, now) {
    const s = normal(state);
    if (s.value === 'all') return true;
    if (!(date instanceof Date) || isNaN(date)) return false;
    now = now || new Date();
    if (s.value === 'today') return startOfDay(date).getTime() === startOfDay(now).getTime();
    if (s.value === 'season') return date >= Network.seasonStart();
    if (s.value === 'week') return date >= new Date(now.getTime() - 7 * DAY);
    if (s.value === 'month') return date >= new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    // custom: from the start of the first day to the end of the last day (local time)
    const from = day(s.start), to = day(s.end);
    if (from && date < from) return false;
    if (to && date >= new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1)) return false;
    return true;
  }

  function label(state) {
    const s = normal(state);
    if (s.value !== 'custom') return LABELS[s.value];
    const fmt = t => { const d = day(t); return d ? d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : ''; };
    const a = fmt(s.start), b = fmt(s.end);
    if (a && b) return `du ${a} au ${b}`;
    if (a) return `depuis le ${a}`;
    if (b) return `jusqu'au ${b}`;
    return LABELS.custom;
  }

  // The date a report is judged on: its last change (modifiedAt), else the day it was made
  function lastChange(record) {
    const at = (record && (record.modifiedAt || record.createdAt));
    const d = at && at.toDate ? at.toDate() : at;
    return d instanceof Date && !isNaN(d) ? d : null;
  }

  function toParams(state, params) {
    const s = normal(state), p = params || new URLSearchParams();
    p.set('period', s.value);
    if (s.value === 'custom') { if (s.start) p.set('start', s.start); if (s.end) p.set('end', s.end); }
    return p;
  }
  const fromParams = params => normal({ value: params.get('period'), start: params.get('start'), end: params.get('end') });

  function attach(o) {
    const state = () => normal({ value: o.select.value, start: o.start.value, end: o.end.value });
    const showCustom = () => { o.custom.style.display = o.select.value === 'custom' ? 'flex' : 'none'; };
    if (o.seasonOption && typeof Network !== 'undefined') o.seasonOption.textContent = Network.seasonLabel(Network.seasonRange());
    showCustom();
    const changed = () => { showCustom(); if (o.onChange) o.onChange(state()); };
    o.select.addEventListener('change', changed);
    o.start.addEventListener('change', changed);
    o.end.addEventListener('change', changed);
    return {
      state,
      reset() { o.select.value = 'all'; o.start.value = ''; o.end.value = ''; showCustom(); }
    };
  }

  return { VALUES, LABELS, matches, label, lastChange, toParams, fromParams, attach };
})();
