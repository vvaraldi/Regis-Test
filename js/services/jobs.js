/**
 * jobs.js - the logic of the Jobs app: statuses, priorities, filters, sorting and the document to save
 * =============================================================================================================
 * Pure functions (tested with arrays in tests/specs/jobs.html); the pages (pages/jobs.html, pages/jobs-admin.html, drawn by js/admin/jobs-view.js) read and write. A job is one thing to do on the trails:
 *
 *   { network, title, description, sector, sectorName, trail, trailId, priority: 'high'|'medium'|'low',
 *     status: 'todo'|'doing'|'done'|'cancelled', createdAt, createdBy, createdByName, updatedAt, updatedBy,
 *     sourceApp: 'jobs'|'inspections'|'signalisations', sourceId,           // where it was created from (the report it points to)
 *     workLinks: [ ... ],        // the travail of the Entretien reports that worked on it (filled by the Entretien report)
 *     closingDescription, closedAt, closedBy }
 *
 * No assignation: a job belongs to nobody, whoever does the work links it from the Entretien report.
 */
const Jobs = (function () {
  'use strict';

  const STATUSES = [
    { id: 'todo', label: 'À faire', color: '#b45309' },
    { id: 'doing', label: 'En cours', color: '#1d4ed8' },
    { id: 'done', label: 'Fait', color: '#15803d' },
    { id: 'cancelled', label: 'Annulé', color: '#6b7280' }
  ];
  const PRIORITIES = [
    { id: 'high', label: 'Haute', icon: '🔴', rank: 0 },
    { id: 'medium', label: 'Moyenne', icon: '🟠', rank: 1 },
    { id: 'low', label: 'Basse', icon: '🟢', rank: 2 }
  ];
  const SOURCES = { jobs: 'Jobs', inspections: 'Inspections', signalisations: 'Signalisations' };
  const DEFAULT_PRIORITY = 'medium';
  const OPEN = ['todo', 'doing'];

  const byId = (list, id) => list.find(x => x.id === id) || null;
  const status = id => byId(STATUSES, id) || STATUSES[0];
  const priority = id => byId(PRIORITIES, id) || byId(PRIORITIES, DEFAULT_PRIORITY);
  const toDate = v => (v ? (v.toDate ? v.toDate() : new Date(v)) : null);
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const two = n => String(n).padStart(2, '0');
  /** "07/11": the day and the month only (short, but enough to tell two tasks apart in a list). '' when there is no valid date. */
  function shortDate(v) {
    const d = toDate(v);
    return d && !isNaN(d) ? `${two(d.getDate())}/${two(d.getMonth() + 1)}` : '';
  }
  /** A task's title with its creation day: "Drainage · 07/11" (nothing added when the title already holds that day). */
  function labelOf(job) {
    const day = shortDate(job.createdAt);
    return day && !String(job.title || '').includes(day) ? `${job.title} · ${day}` : String(job.title || '');
  }

  /** The next priority when the icon is clicked: high -> medium -> low -> high. */
  function nextPriority(id) {
    const i = PRIORITIES.findIndex(p => p.id === id);
    return PRIORITIES[(i + 1) % PRIORITIES.length].id;
  }

  const isOpen = job => OPEN.includes(job.status);

  /**
   * The filters of the list. `f`: { status: '' | id | 'open' (todo + doing), priority, sector, trail (trailId), source, text,
   * from, to (Date or yyyy-mm-dd, on the creation date) }. Cancelled jobs are only listed when asked for (status 'cancelled' or 'all').
   */
  function filter(jobs, f) {
    f = f || {};
    const day = v => { if (!v) return null; if (v instanceof Date) return v; const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
    const from = day(f.from), toRaw = day(f.to);
    const to = toRaw ? new Date(toRaw.getFullYear(), toRaw.getMonth(), toRaw.getDate() + 1) : null;   // the whole last day
    const q = norm(f.text).trim();
    return jobs.filter(j => {
      const s = f.status || 'open';
      if (s === 'open' ? !isOpen(j) : (s !== 'all' && j.status !== s)) return false;
      if (f.priority && j.priority !== f.priority) return false;
      if (f.sector && j.sector !== f.sector) return false;
      if (f.trail && j.trailId !== f.trail) return false;
      if (f.source && j.sourceApp !== f.source) return false;
      const created = toDate(j.createdAt);
      if (from && (!created || created < from)) return false;
      if (to && (!created || created >= to)) return false;
      if (q && !norm([j.title, j.description, j.trail, j.sectorName, j.createdByName].join(' ')).includes(q)) return false;
      return true;
    });
  }

  /** Sorting: by priority (high first), by creation date (newest first), by title, by trail or by status. Ties: newest first. */
  function sort(jobs, by, desc) {
    const time = j => { const d = toDate(j.createdAt); return d ? d.getTime() : 0; };
    const keys = {
      priority: (a, b) => priority(a.priority).rank - priority(b.priority).rank,
      created: (a, b) => time(b) - time(a),
      title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'fr'),
      trail: (a, b) => String(a.trail || a.sectorName || '').localeCompare(String(b.trail || b.sectorName || ''), 'fr'),
      status: (a, b) => STATUSES.findIndex(s => s.id === a.status) - STATUSES.findIndex(s => s.id === b.status)
    };
    const cmp = keys[by] || keys.created;
    const sorted = jobs.slice().sort((a, b) => cmp(a, b) || time(b) - time(a));
    return desc ? sorted.reverse() : sorted;
  }

  /** The error of a form (title, place), or '' when it can be saved. */
  function validate(input) {
    const title = String(input.title || '').trim();
    if (!title) return 'Le titre est obligatoire.';
    if (title.length > 200) return 'Le titre est trop long (200 caractères au plus).';
    if (!input.sector && !input.trailId && !input.trail) return 'Choisissez un secteur ou un sentier.';
    return '';
  }

  /** The document to create. `ctx`: { network, uid, name, now } - `now` is the server timestamp (or a Date in tests). */
  function newJob(input, ctx) {
    const doc = {
      network: ctx.network,
      title: String(input.title).trim(),
      description: String(input.description || '').trim(),
      sector: input.sector || null,
      sectorName: input.sectorName || null,
      trail: input.trail || null,
      trailId: input.trailId || null,
      priority: priority(input.priority).id,
      status: 'todo',
      createdAt: ctx.now,
      createdBy: ctx.uid,
      createdByName: ctx.name || '',
      updatedAt: ctx.now,
      updatedBy: ctx.uid,
      sourceApp: SOURCES[input.sourceApp] ? input.sourceApp : 'jobs',
      workLinks: []
    };
    if (input.sourceId) doc.sourceId = input.sourceId;
    return doc;
  }

  /** The fields written when an admin changes the status: closing a job (done / cancelled) also records who and when. */
  function statusPatch(newStatus, ctx, closingDescription) {
    const patch = { status: newStatus, updatedAt: ctx.now, updatedBy: ctx.uid };
    if (newStatus === 'done' || newStatus === 'cancelled') {
      patch.closedAt = ctx.now;
      patch.closedBy = ctx.uid;
      if (ctx.name) patch.closedByName = ctx.name;   // shown in the window of the closing (the uid alone says nothing)
      if (closingDescription) patch.closingDescription = String(closingDescription).trim();
    }
    return patch;
  }

  /** The counters shown above the list. */
  function counts(jobs) {
    const c = { todo: 0, doing: 0, done: 0, cancelled: 0, highOpen: 0 };
    jobs.forEach(j => { if (c[j.status] !== undefined) c[j.status]++; if (isOpen(j) && j.priority === 'high') c.highOpen++; });
    return c;
  }

  /**
   * The open jobs that concern a place, for the Entretien report: `sectorId` and/or `trailId` (both optional). A job of the sector without a
   * trail concerns every trail of that sector. With no place at all, every open job is returned.
   */
  function forPlace(jobs, sectorId, trailId) {
    return jobs.filter(j => {
      if (!isOpen(j)) return false;
      if (sectorId && j.sector !== sectorId) return false;
      if (trailId && j.trailId && j.trailId !== trailId) return false;
      return true;
    });
  }

  /** The most recent link of a job's `workLinks` (by date; the last one of the list wins a tie), or null. */
  function lastLink(links) {
    let best = null, bestTime = -Infinity;
    (links || []).forEach(l => {
      const d = toDate(l.date);
      const t = d && !isNaN(d) ? d.getTime() : -Infinity;
      if (t >= bestTime) { best = l; bestTime = t; }
    });
    return best;
  }

  /**
   * What an Entretien report does to a job when it is saved: `links` are the report's travail that work on the job (an empty list = the report
   * no longer works on it: its old links are removed). The job's status follows the MOST RECENT travail linked to it, whichever report it is in:
   * "En cours" keeps it under way, "Fait" closes it (with that travail's text as the closing description) - so only the last travail can complete
   * a task that took several. Returns the fields to write, or null when nothing may change (a cancelled job).
   *   ctx: { uid, now, del } - `now` the server timestamp, `del` the field deletion value (firebase.firestore.FieldValue.delete())
   */
  function linkOutcome(job, logId, links, ctx) {
    if (!job || job.status === 'cancelled') return null;
    const workLinks = (job.workLinks || []).filter(l => l.logId !== logId).concat(links || []);
    const patch = { workLinks, updatedAt: ctx.now, updatedBy: ctx.uid };
    const last = lastLink(workLinks);
    if (!last) return patch;                       // no travail left on this job: the status stays as it is
    if (last.status === 'done') {
      patch.status = 'done';
      patch.closedAt = ctx.now;
      patch.closedBy = ctx.uid;
      patch.closingDescription = String(last.text || '').trim();
    } else {
      patch.status = 'doing';
      if (job.status === 'done') { patch.closedAt = ctx.del; patch.closedBy = ctx.del; patch.closingDescription = ctx.del; }   // reopened: the closing fields go
    }
    return patch;
  }

  return { STATUSES, PRIORITIES, SOURCES, OPEN, DEFAULT_PRIORITY, status, priority, nextPriority, isOpen, filter, sort, validate, newJob, statusPatch, counts, forPlace, lastLink, linkOutcome, shortDate, labelOf };
})();
if (typeof window !== 'undefined') window.Jobs = Jobs;
