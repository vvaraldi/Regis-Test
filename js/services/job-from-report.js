/**
 * job-from-report.js - "Créer une tâche" in the details of an inspection or of a signalisation
 * =============================================================================================
 * Adds a "Tâches" block at the end of a report's details window: the tasks already created from this report (so nobody makes the same task
 * twice) and a button that opens a small form, pre-filled from the report (the place, the problems found, the notes). The task is saved in
 * the `jobs` collection with `sourceApp` ('inspections' | 'signalisations') and `sourceId` (the report), like a task made in the Tâches app.
 *
 *   if (JobFromReport.enabled(userData, 'inspections')) JobFromReport.mount(modalBodyEl, userData, {
 *     sourceApp: 'inspections', sourceId: 'abc',
 *     place: { sector, sectorName, trail, trailId },     // what the report is about (any part may be missing)
 *     issues: ['Branches', ...], notes: 'text'            // suggestions for the title and the description
 *   });
 *
 * Switch: APP_CONFIG.jobs.createFrom.<inspections|signalisations> (js/core/config.js). Shown only to an administrator or a user with allowJobs.
 * Needs: Jobs, SectorService, Network, the global `db`.
 */
const JobFromReport = (function () {
  'use strict';

  const STYLE = `
    .jfr-section { margin-top: 1.25rem; }
    .jfr-section h4 { margin: 0 0 0.5rem; }
    .jfr-list { list-style: none; margin: 0 0 0.6rem; padding: 0; display: grid; gap: 0.3rem; font-size: 0.9rem; }
    .jfr-pill { display: inline-block; border-radius: 999px; padding: 0 0.5rem; color: #fff; font-weight: 700; font-size: 0.75rem; margin-left: 0.4rem; }
    .jfr-empty { color: var(--theme-text-secondary); font-size: 0.85rem; margin: 0 0 0.6rem; }
    .jfr-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 1100; align-items: center; justify-content: center; padding: 1rem; }
    .jfr-modal.show { display: flex; }
    .jfr-modal__content { background: var(--theme-surface); border-radius: var(--radius-lg); max-width: 560px; width: 100%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
    .jfr-modal__header { display: flex; align-items: center; justify-content: space-between; padding: 1rem; border-bottom: 1px solid var(--theme-border); }
    .jfr-modal__title { font-size: 1.1rem; font-weight: 600; margin: 0; }
    .jfr-modal__close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--theme-text-secondary); }
    .jfr-modal__body { padding: 1rem; overflow-y: auto; flex: 1; }
    .jfr-modal__footer { display: flex; gap: 0.5rem; justify-content: flex-end; padding: 1rem; border-top: 1px solid var(--theme-border); }
    .jfr-modal .form-group { margin-bottom: 0.75rem; }
    .jfr-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
    .jfr-chip { border: 1px solid var(--theme-border); background: var(--theme-surface-alt); border-radius: 999px; padding: 0.15rem 0.7rem; font-size: 0.8rem; cursor: pointer; color: var(--theme-text); }
    .jfr-chip:hover { border-color: var(--theme-accent); }
    .jfr-tick { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
    .jfr-tick__label { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; cursor: pointer; flex: 0 0 auto; padding-top: 0.4rem; }
    .jfr-tick__label input { width: 20px; height: 20px; }
    .jfr-tick__text { flex: 1 1 260px; }
    .jfr-tick__text textarea { width: 100%; }`;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let sectorsPromise = null;
  const loadSectors = () => (sectorsPromise = sectorsPromise || SectorService.load().catch(e => { console.error('Tâches: secteurs', e); return []; }));

  /** Is the button offered to this person for this kind of report? (the config switch, then the permission) */
  function enabled(userData, sourceApp) {
    const cfg = (APP_CONFIG.jobs && APP_CONFIG.jobs.createFrom) || {};
    if (cfg[sourceApp] !== true || !userData) return false;
    return userData.role === 'admin' || userData.role === 'system_admin' || userData.allowJobs === true;
  }

  function ensureStyle() {
    if (document.getElementById('jfr-style')) return;
    const st = document.createElement('style');
    st.id = 'jfr-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  function ensureModal() {
    if (document.getElementById('jfr-modal')) return;
    ensureStyle();
    const m = document.createElement('div');
    m.className = 'jfr-modal';
    m.id = 'jfr-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'jfr-title-h');
    m.innerHTML = `
      <div class="jfr-modal__content">
        <div class="jfr-modal__header"><h3 class="jfr-modal__title" id="jfr-title-h">Créer une tâche</h3><button type="button" class="jfr-modal__close" id="jfr-close" aria-label="Fermer">×</button></div>
        <form class="jfr-modal__body" id="jfr-form" novalidate>
          <div id="jfr-chips-box" class="form-group" hidden><label class="form-label">Problèmes de ce rapport (cliquer pour reprendre dans le titre)</label><div class="jfr-chips" id="jfr-chips"></div></div>
          <div class="form-group"><label class="form-label form-label--required" for="jfr-title">Titre</label><input type="text" class="form-input" id="jfr-title" maxlength="200"></div>
          <div class="form-group"><label class="form-label" for="jfr-description">Description</label><textarea class="form-textarea" id="jfr-description" rows="4"></textarea></div>
          <div class="form-group"><label class="form-label form-label--required" for="jfr-sector">Secteur</label><select class="form-select" id="jfr-sector"></select></div>
          <div class="form-group"><label class="form-label" for="jfr-trail">Sentier</label><select class="form-select" id="jfr-trail"></select></div>
          <div class="form-group"><label class="form-label" for="jfr-priority">Priorité</label><select class="form-select" id="jfr-priority">${Jobs.PRIORITIES.map(p => `<option value="${p.id}"${p.id === Jobs.DEFAULT_PRIORITY ? ' selected' : ''}>${p.icon} ${p.label}</option>`).join('')}</select></div>
          <p id="jfr-error" role="alert" style="color:var(--color-danger);font-size:0.85rem;display:none"></p>
        </form>
        <div class="jfr-modal__footer"><button type="button" class="btn btn-secondary" id="jfr-cancel">Annuler</button><button type="button" class="btn btn-primary" id="jfr-save">Créer la tâche</button></div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
    document.getElementById('jfr-close').addEventListener('click', () => m.classList.remove('show'));
    document.getElementById('jfr-cancel').addEventListener('click', () => m.classList.remove('show'));
  }

  /** The tasks already created from this report. A failed read gives null (the block then only offers the button). */
  async function linked(sourceApp, sourceId) {
    try {
      const snap = await db.collection('jobs').where('sourceId', '==', sourceId).get();
      return snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(j => j.sourceApp === sourceApp && j.sourceId === sourceId && Network.matches(j));
    } catch (e) {
      console.warn('Tâches: could not read the tasks of this report', e);
      return null;
    }
  }

  const listHtml = jobs => !jobs ? '' : (jobs.length
    ? `<ul class="jfr-list">${jobs.map(j => { const s = Jobs.status(j.status); return `<li>${Jobs.priority(j.priority).icon} <strong>${esc(j.title)}</strong><span class="jfr-pill" style="background:${s.color}">${esc(s.label)}</span></li>`; }).join('')}</ul>`
    : '<p class="jfr-empty">Aucune tâche créée à partir de ce rapport.</p>');

  async function openForm(ctx, onCreated) {
    ensureModal();
    const $ = id => document.getElementById(id);
    const sectors = await loadSectors();
    const place = ctx.place || {};
    $('jfr-form').reset();
    $('jfr-error').style.display = 'none';
    // the problems found: chips that put one in the title; the first one is used when the report has only that
    const issues = (ctx.issues || []).filter(Boolean);
    $('jfr-chips-box').hidden = issues.length === 0;
    $('jfr-chips').innerHTML = issues.map((t, i) => `<button type="button" class="jfr-chip" data-i="${i}">${esc(t)}</button>`).join('');
    $('jfr-chips').onclick = e => { const b = e.target.closest('[data-i]'); if (b) $('jfr-title').value = issues[+b.dataset.i]; };
    $('jfr-title').value = issues.length === 1 ? issues[0] : '';
    $('jfr-description').value = ctx.notes || '';
    SectorService.fillSectors($('jfr-sector'), sectors, '-- Sélectionner un secteur --');
    const sector = SectorService.selectSector($('jfr-sector'), sectors, place.sector);
    SectorService.fillTrails($('jfr-trail'), sector || SectorService.find(sectors, $('jfr-sector').value), '-- Tout le secteur / aucun sentier précis --');
    if (place.trail || place.trailId) SectorService.selectTrail($('jfr-trail'), place.trail, place.trailId);
    $('jfr-sector').onchange = () => SectorService.fillTrails($('jfr-trail'), SectorService.find(sectors, $('jfr-sector').value), '-- Tout le secteur / aucun sentier précis --');
    $('jfr-save').disabled = false;
    $('jfr-save').onclick = async () => {
      const sec = SectorService.find(sectors, $('jfr-sector').value);
      const trail = SectorService.readTrail($('jfr-trail'));
      // a place that is not a trail of the list (a shelter): keep its name as the place when nothing else was chosen
      const keepName = !trail.name && !sec && place.trail ? place.trail : null;
      const input = { title: $('jfr-title').value, description: $('jfr-description').value, sector: sec ? sec.id : null, sectorName: sec ? sec.name : null,
        trail: trail.name || keepName, trailId: trail.id, priority: $('jfr-priority').value, sourceApp: ctx.sourceApp, sourceId: ctx.sourceId };
      const problem = Jobs.validate(input);
      const err = $('jfr-error');
      if (problem) { err.textContent = problem; err.style.display = ''; return; }
      $('jfr-save').disabled = true;
      try {
        await db.collection('jobs').add(Jobs.newJob(input, { network: Network.current(), uid: ctx.uid, name: ctx.name, now: firebase.firestore.FieldValue.serverTimestamp() }));
        $('jfr-modal').classList.remove('show');
        if (typeof showMessage === 'function') showMessage('Tâche créée.', 'success', 3000);
        onCreated();
      } catch (e) {
        console.error('Tâches:', e);
        err.textContent = 'La tâche n’a pas pu être enregistrée. Réessayez dans un moment.';
        err.style.display = '';
        $('jfr-save').disabled = false;
      }
    };
    $('jfr-modal').classList.add('show');
    $('jfr-title').focus();
  }

  /** Adds the "Tâches" block at the end of `container` (the details window's body). Does nothing when the switch / permission say no. */
  async function mount(container, userData, ctx) {
    if (!container || !enabled(userData, ctx.sourceApp)) return;
    const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : null;
    const full = Object.assign({ uid, name: userData.name }, ctx);
    const section = document.createElement('div');
    section.className = 'detail-section jfr-section';
    section.innerHTML = '<h4>🛠️ Tâches</h4><div class="jfr-list-box"></div><button type="button" class="btn btn-secondary btn-sm jfr-new">➕ Créer une tâche</button>';
    container.appendChild(section);
    const box = section.querySelector('.jfr-list-box');
    const refresh = async () => { box.innerHTML = listHtml(await linked(ctx.sourceApp, ctx.sourceId)); };
    section.querySelector('.jfr-new').addEventListener('click', () => openForm(full, refresh));
    await refresh();
  }

  /**
   * The tick box "Créer une tâche" of the inspection forms (trail and shelter), with a description box beside it that is required once it is ticked.
   *   const tick = JobFromReport.mountTick(document.getElementById('job-tick-box'), userData);   // null when the switch / the permission say no
   *   if (tick && tick.error()) { ...show it... }                                                // the description is missing
   *   if (tick && tick.wanted()) batch.set(db.collection('jobs').doc(), tick.build({ place, sector, sectorName, trailId, name, date, sourceId: inspectionRef.id }));
   * The task: title "<place> - <name of the person> - dd/mm" (the day of the inspection), the description typed, the place of the inspection, medium priority,
   * origin = that inspection. The box and the text have ids (create-job, job-description), so an unsent-report draft keeps them.
   */
  function mountTick(box, userData) {
    if (!box || !enabled(userData, 'inspections')) return null;
    ensureStyle();
    box.innerHTML = `
      <div class="form-section">
        <div class="form-section-header"><h2 class="form-section-title">🛠️ Tâche à faire</h2></div>
        <div class="form-section-body">
          <div class="jfr-tick">
            <label class="jfr-tick__label" for="create-job"><input type="checkbox" id="create-job" data-not-issue> Créer une tâche</label>
            <div class="jfr-tick__text form-group" id="job-description-group" hidden>
              <label class="form-label form-label--required" for="job-description">Description de la tâche</label>
              <textarea class="form-textarea" id="job-description" rows="3" placeholder="Que faut-il faire, et où exactement ?"></textarea>
            </div>
          </div>
          <p class="form-hint" style="margin-top:0.4rem;">Crée une tâche (application Tâches) liée à cette inspection, à l’endroit inspecté.</p>
        </div>
      </div>`;
    const cb = box.querySelector('#create-job'), ta = box.querySelector('#job-description'), group = box.querySelector('#job-description-group');
    const sync = () => { group.hidden = !cb.checked; };
    cb.addEventListener('change', sync);
    if (cb.form) cb.form.addEventListener('reset', () => setTimeout(sync, 0));
    return {
      wanted: () => cb.checked,
      error: () => (cb.checked && !ta.value.trim() ? 'Décrivez la tâche à créer, ou décochez « Créer une tâche ».' : ''),
      build(info) {
        const title = [info.place, info.name, Jobs.shortDate(info.date)].filter(Boolean).join(' - ');
        const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : null;
        return Jobs.newJob({ title, description: ta.value, sector: info.sector || null, sectorName: info.sectorName || null, trail: info.place, trailId: info.trailId || null,
          priority: Jobs.DEFAULT_PRIORITY, sourceApp: 'inspections', sourceId: info.sourceId },
          { network: Network.current(), uid, name: info.name, now: firebase.firestore.FieldValue.serverTimestamp() });
      }
    };
  }

  return { enabled, mount, mountTick };
})();
if (typeof window !== 'undefined') window.JobFromReport = JobFromReport;
