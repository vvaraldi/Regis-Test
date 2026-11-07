/**
 * report-peek.js - a small READ-ONLY window on a record, opened from a task (Tâches app)
 * ======================================================================================
 * Shows the essentials of three kinds of record, always in the same layout: date, person, place, description, photos with their position:
 *
 *   ReportPeek.origin(job)      the inspection (trail or shelter) or the signalisation the task was created from (job.sourceApp / job.sourceId)
 *   ReportPeek.work(job, link)  a travail of an Entretien report that worked on the task (link = one item of job.workLinks: logId, entryIndex, ...)
 *   ReportPeek.closing(job)     how a task was closed or cancelled from the Tâches app (who, when, the closing description)
 *
 * Nothing can be changed here (the photo links are only "📍 Carte" and Google Maps). A record that can no longer be read says so and shows what the task
 * itself kept. Needs: Jobs, PhotoMapModal (position links), the global `db`; SectorService is used for a sector name when it is there.
 */
const ReportPeek = (function () {
  'use strict';

  const STYLE = `
    .rp-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 1100; align-items: center; justify-content: center; padding: 1rem; }
    .rp-modal.show { display: flex; }
    .rp-modal__content { background: var(--theme-surface); border-radius: var(--radius-lg); max-width: 620px; width: 100%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
    .rp-modal__header { display: flex; align-items: center; justify-content: space-between; padding: 1rem; border-bottom: 1px solid var(--theme-border); }
    .rp-modal__title { font-size: 1.1rem; font-weight: 600; margin: 0; }
    .rp-modal__close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--theme-text-secondary); }
    .rp-modal__body { padding: 1rem; overflow-y: auto; flex: 1; }
    .rp-modal__footer { display: flex; justify-content: flex-end; padding: 1rem; border-top: 1px solid var(--theme-border); }
    .rp-row { display: grid; grid-template-columns: 8rem 1fr; gap: 0.5rem; padding: 0.4rem 0; border-bottom: 1px solid var(--theme-border); font-size: 0.9rem; }
    .rp-row__label { color: var(--theme-text-secondary); }
    .rp-text { white-space: pre-wrap; }
    .rp-note { color: var(--theme-text-secondary); font-size: 0.85rem; margin: 0.6rem 0; }
    .rp-photos { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.4rem; }
    .rp-photo img { max-width: 150px; max-height: 150px; border-radius: var(--radius-md); cursor: pointer; display: block; }
    .rp-photo .photo-location { font-size: 0.8rem; margin-top: 0.2rem; }
    @media (max-width: 640px) { .rp-row { grid-template-columns: 1fr; gap: 0.1rem; } }`;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toDate = v => (v ? (v.toDate ? v.toDate() : new Date(v)) : null);
  const when = v => {
    const d = toDate(v);
    return d && !isNaN(d) ? d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) + ' ' + d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '–';
  };
  const day = v => { const d = toDate(v); return d && !isNaN(d) ? d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) : '–'; };
  const row = (label, html) => `<div class="rp-row"><div class="rp-row__label">${esc(label)}</div><div>${html}</div></div>`;
  const text = s => (s ? `<div class="rp-text">${esc(s)}</div>` : '<span class="rp-note">Aucune description.</span>');
  const photosHtml = photos => (photos && photos.length
    ? `<div class="rp-photos">${photos.map(p => `<div class="rp-photo"><img src="${esc(p.url)}" alt="Photo" onclick="window.open(this.src,'_blank')">${typeof PhotoMapModal !== 'undefined' ? PhotoMapModal.locationLinks(p, {}) : ''}</div>`).join('')}</div>`
    : '<span class="rp-note">Aucune photo.</span>');

  function ensure() {
    if (document.getElementById('rp-modal')) return;
    const st = document.createElement('style');
    st.id = 'rp-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
    const m = document.createElement('div');
    m.className = 'rp-modal';
    m.id = 'rp-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'rp-title');
    m.innerHTML = `<div class="rp-modal__content">
      <div class="rp-modal__header"><h3 class="rp-modal__title" id="rp-title"></h3><button type="button" class="rp-modal__close" id="rp-close" aria-label="Fermer">×</button></div>
      <div class="rp-modal__body" id="rp-body"></div>
      <div class="rp-modal__footer"><button type="button" class="btn btn-secondary" id="rp-ok">Fermer</button></div></div>`;
    document.body.appendChild(m);
    const close = () => m.classList.remove('show');
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.getElementById('rp-close').addEventListener('click', close);
    document.getElementById('rp-ok').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  function show(title, html) {
    ensure();
    document.getElementById('rp-title').textContent = title;
    document.getElementById('rp-body').innerHTML = html;
    document.getElementById('rp-modal').classList.add('show');
  }

  async function getDoc(collection, id) {
    try {
      const snap = await db.collection(collection).doc(id).get();
      return snap.exists ? snap.data() : null;
    } catch (e) {
      console.warn('Tâches: could not read', collection, id, e);
      return null;
    }
  }
  async function sectorName(id) {
    if (!id) return '';
    try { return SectorService.nameOf(await SectorService.load(), id, id); } catch (e) { return id; }
  }
  const unavailable = what => `<p class="rp-note">${esc(what)} n’est plus disponible ou ne peut pas être lu pour le moment.</p>`;

  /** The inspection or the signalisation a task was created from. */
  async function origin(job) {
    show('Rapport d’origine', '<p class="rp-note">Chargement…</p>');
    const here = [job.trail, job.sectorName].filter(Boolean).join(' - ');
    if (job.sourceApp === 'signalisations') {
      const r = await getDoc('signalisations', job.sourceId);
      if (!r) return show('Signalisation d’origine', unavailable('La signalisation') + row('Lieu', esc(here || '–')));
      const photos = typeof PhotoService !== 'undefined' ? PhotoService.photosFrom(r) : (r.photos || []);
      return show('Signalisation d’origine',
        row('Date', esc(when(r.createdAt))) + row('Personne', esc(r.inspectorName || '–')) +
        row('Lieu', esc([r.trail, r.sectorDisplayName || await sectorName(r.sector)].filter(Boolean).join(' - ') || here || '–')) +
        row('Description', text(r.comments)) + row('Photos', photosHtml(photos)));
    }
    // an inspection: a trail or a shelter (the task only knows the id)
    let d = await getDoc('trail_inspections', job.sourceId), isShelter = false;
    if (!d) { d = await getDoc('shelter_inspections', job.sourceId); isShelter = !!d; }
    if (!d) return show('Inspection d’origine', unavailable('L’inspection') + row('Lieu', esc(here || '–')));
    const place = await getDoc(isShelter ? 'shelters' : 'trails', isShelter ? d.shelter_id : d.trail_id);
    const issues = Array.isArray(d.issues) && d.issues.length ? '<strong>Problèmes :</strong> ' + esc(d.issues.join(', ')) : '';
    const description = (issues ? `<div class="rp-text">${issues}</div>` : '') + (d.notes ? `<div class="rp-text" style="margin-top:0.3rem">${esc(d.notes)}</div>` : '');
    show(isShelter ? 'Inspection d’abri d’origine' : 'Inspection de sentier d’origine',
      row('Date', esc(when(d.date))) + row('Personne', esc(d.inspector_name || '–')) +
      row('Lieu', esc([(place && place.name) || job.trail, job.sectorName].filter(Boolean).join(' - ') || '–')) +
      row('Description', description || '<span class="rp-note">Aucune description.</span>') + row('Photos', photosHtml(d.photos)));
  }

  /** One travail of an Entretien report that worked on a task (`link` is an item of job.workLinks). */
  async function work(job, link) {
    show('Travail d’entretien', '<p class="rp-note">Chargement…</p>');
    const log = link.logId ? await getDoc('maintenance_logs', link.logId) : null;
    const entries = (log && log.entries) || [];
    const entry = (Number.isInteger(link.entryIndex) && entries[link.entryIndex] && (entries[link.entryIndex].jobId === job.id || !entries[link.entryIndex].jobId) ? entries[link.entryIndex] : null)
      || entries.find(e => e.jobId === job.id && e.jobText === link.text) || entries.find(e => e.jobId === job.id) || null;
    const state = link.status ? Jobs.status(link.status).label : '';
    const people = [log && log.builderName || link.builderName, ...(log && log.supportBuilderNames || []), ...(log && log.volunteerNames || [])].filter(Boolean);
    const place = [entry && entry.trailName || link.trail, await sectorName((entry && entry.sector) || link.sector)].filter(Boolean).join(' - ');
    show('Travail d’entretien',
      row('Date', esc(day(log ? log.date : link.date))) +
      row('Personne', esc((log && log.builderName) || link.builderName || '–') + (people.length > 1 ? `<span class="rp-note" style="display:block;margin:0">Avec : ${esc(people.slice(1).join(', '))}</span>` : '')) +
      row('Lieu', esc(place || '–')) + row('État de la tâche', esc(state || '–')) +
      row('Description', text((entry && entry.jobText) || link.text)) + row('Photos', photosHtml(entry && entry.photos)) +
      (log ? '' : unavailable('Le rapport d’entretien')));
  }

  /** A task closed (or cancelled) from the Tâches app: who, when and the closing description. */
  function closing(job) {
    const cancelled = job.status === 'cancelled';
    show(cancelled ? 'Tâche annulée' : 'Tâche fermée',
      row('Tâche', esc(job.title)) + row('Statut', esc(Jobs.status(job.status).label)) +
      row(cancelled ? 'Annulée par' : 'Fermée par', esc(job.closedByName || '–')) + row('Le', esc(when(job.closedAt))) +
      row('Description', text(job.closingDescription)) +
      row('Lieu', esc([job.trail, job.sectorName].filter(Boolean).join(' - ') || '–')) + row('Description de la tâche', text(job.description)));
  }

  return { origin, work, closing };
})();
if (typeof window !== 'undefined') window.ReportPeek = ReportPeek;
