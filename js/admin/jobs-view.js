/**
 * jobs-view.js - the list of jobs (Jobs app): filters, table, detail window, creation, and the administrator's actions
 * ======================================================================================================================
 * One component for the two pages: pages/jobs.html (everybody allowed: list, create, details) and pages/jobs-admin.html (administrators:
 * the same, plus the priority icon that cycles high / medium / low, "Marquer comme fait", "Annuler le job", "Rouvrir", and the cancelled
 * tasks in the list). The logic of the filters and of the documents is js/services/jobs.js (tested with arrays).
 *
 *   JobsView.mount(root, { admin: false, uid, name });
 *
 * Needs: Jobs, SectorService, Network, the global `db`. Reads the activity's tasks once when opened and again after each write.
 */
const JobsView = (function () {
  'use strict';

  const STYLE = `
    .jb-counters { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .jb-counter { background: var(--theme-surface); border: 1px solid var(--theme-border); border-radius: var(--radius-md); padding: 0.5rem 0.9rem; text-align: center; min-width: 90px; }
    .jb-counter__value { font-size: 1.4rem; font-weight: 700; color: var(--theme-accent); }
    .jb-counter__label { font-size: 0.75rem; color: var(--theme-text-secondary); }
    .jb-filters { display: flex; align-items: center; gap: 0.5rem 0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .jb-filters .form-input, .jb-filters .form-select { width: auto; }
    .jb-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .jb-pill { display: inline-block; border-radius: 999px; padding: 0.1rem 0.6rem; color: #fff; font-weight: 700; font-size: 0.8rem; white-space: nowrap; }
    .jb-prio { background: none; border: none; font-size: 1.3rem; line-height: 1; padding: 0.1rem 0.25rem; cursor: default; }
    .jb-prio--admin { cursor: pointer; border-radius: var(--radius-md); }
    .jb-prio--admin:hover { background: var(--theme-surface-alt); }
    /* An open job that is old (config jobs.oldDays): light orange line and the number of days */
    .jb-row--old > td { background: #fff1e0; }
    .jb-old { color: #b45309; font-weight: 700; white-space: nowrap; }
    [data-theme="dark"] .jb-row--old > td { background: rgba(245, 158, 11, 0.18); }
    [data-theme="dark"] .jb-old { color: #fbbf24; }
    .jb-link { background: none; border: none; padding: 0; color: var(--theme-accent); font: inherit; font-weight: 600; text-align: left; cursor: pointer; text-decoration: underline; }
    /* Phones: the priority dot and the links of the table are at least 44 px high to tap (they were 18 to 24 px) */
    @media (max-width: 768px) {
      .jb-prio { min-width: 44px; min-height: 44px; }
      .jb-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 0.25rem; }
    }
    .jb-sub { display: block; font-size: 0.8rem; color: var(--theme-text-secondary); }
    .jb-empty { color: var(--theme-text-secondary); font-size: 0.9rem; }
    .jb-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 1rem; }
    .jb-modal.show { display: flex; }
    .jb-modal__content { background: var(--theme-surface); border-radius: var(--radius-lg); max-width: 640px; width: 100%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
    .jb-modal__header { display: flex; align-items: center; justify-content: space-between; padding: 1rem; border-bottom: 1px solid var(--theme-border); }
    .jb-modal__title { font-size: 1.1rem; font-weight: 600; }
    .jb-modal__close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--theme-text-secondary); }
    .jb-modal__body { padding: 1rem; overflow-y: auto; flex: 1; }
    .jb-modal__footer { display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap; padding: 1rem; border-top: 1px solid var(--theme-border); }
    .jb-field { display: grid; grid-template-columns: 11rem 1fr; gap: 0.5rem; padding: 0.35rem 0; border-bottom: 1px solid var(--theme-border); font-size: 0.9rem; }
    .jb-field__label { color: var(--theme-text-secondary); }
    .jb-desc { white-space: pre-wrap; }
    .jb-form .form-group { margin-bottom: 0.75rem; }
    @media (max-width: 768px) { .jb-field { grid-template-columns: 1fr; gap: 0.1rem; } .jb-counter { min-width: 70px; } }`;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toDate = v => (v ? (v.toDate ? v.toDate() : new Date(v)) : null);
  const fmtDate = v => { const d = toDate(v); return d && !isNaN(d) ? d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '–'; };
  const fmtDateTime = v => { const d = toDate(v); return d && !isNaN(d) ? `${fmtDate(d)} ${d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}` : '–'; };
  const pill = id => { const s = Jobs.status(id); return `<span class="jb-pill" style="background:${s.color}">${esc(s.label)}</span>`; };

  function mount(root, opts) {
    if (!root || root.dataset.jbMounted) return;
    root.dataset.jbMounted = '1';
    opts = opts || {};
    const admin = opts.admin === true;
    if (!document.getElementById('jb-style')) {
      const st = document.createElement('style');
      st.id = 'jb-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    const statusOptions = [['open', 'Ouverts (à faire + en cours)'], ['todo', 'À faire'], ['doing', 'En cours'], ['done', 'Faits']]
      .concat(admin ? [['cancelled', 'Annulés']] : []).concat([['all', admin ? 'Tous' : 'Tous (avec les faits)']]);
    root.innerHTML = `
      <div class="jb-counters" id="jb-counters"></div>
      <div class="jb-toolbar">
        <button type="button" class="btn btn-primary btn-sm" id="jb-new">➕ Nouveau job</button>
        <span class="jb-sub" id="jb-count"></span>
      </div>
      <div class="jb-filters">
        <select class="form-select" id="jb-f-status" aria-label="Statut">${statusOptions.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select>
        <select class="form-select" id="jb-f-priority" aria-label="Priorité"><option value="">Toutes les priorités</option>${Jobs.PRIORITIES.map(p => `<option value="${p.id}">${p.icon} ${p.label}</option>`).join('')}</select>
        <select class="form-select" id="jb-f-sector" aria-label="Secteur"><option value="">Tous les secteurs</option></select>
        <select class="form-select" id="jb-f-trail" aria-label="Sentier"><option value="">Tous les sentiers</option></select>
        <select class="form-select" id="jb-f-mine" aria-label="Mes jobs"><option value="">Tous les jobs</option><option value="1">Mes jobs (créés ou travaillés par moi)</option></select>
        <select class="form-select" id="jb-f-source" aria-label="Origine"><option value="">Toutes les origines</option>${Object.keys(Jobs.SOURCES).map(k => `<option value="${k}">${esc(Jobs.SOURCES[k])}</option>`).join('')}</select>
        <label class="jb-sub" for="jb-f-from" style="display:inline">Créé du</label><input type="date" class="form-input" id="jb-f-from" aria-label="Créé à partir du">
        <label class="jb-sub" for="jb-f-to" style="display:inline">au</label><input type="date" class="form-input" id="jb-f-to" aria-label="Créé jusqu’au">
        <input type="search" class="form-input" id="jb-f-text" placeholder="Rechercher" aria-label="Recherche">
        <select class="form-select" id="jb-sort" aria-label="Tri">
          <option value="priority">Tri : priorité</option><option value="created">Tri : plus récentes</option><option value="trail">Tri : sentier</option><option value="status">Tri : statut</option><option value="title">Tri : titre</option>
        </select>
      </div>
      <div class="data-table__body">
        <table class="table table--hover table--responsive" id="jb-table">
          <thead><tr><th scope="col" title="Priorité">!</th><th scope="col">Job</th><th scope="col">Sentier</th><th scope="col">Statut</th><th scope="col">Créé</th><th scope="col">Modifié</th><th scope="col">Origine</th></tr></thead>
          <tbody id="jb-tbody"></tbody>
        </table>
      </div>
      <p class="jb-empty" id="jb-empty" style="display:none">Aucun job pour ces filtres.</p>

      <div class="jb-modal" id="jb-detail" role="dialog" aria-modal="true" aria-labelledby="jb-detail-title">
        <div class="jb-modal__content">
          <div class="jb-modal__header"><h3 class="jb-modal__title" id="jb-detail-title">Job</h3><button type="button" class="jb-modal__close" id="jb-detail-close" aria-label="Fermer">×</button></div>
          <div class="jb-modal__body" id="jb-detail-body"></div>
          <div class="jb-modal__footer" id="jb-detail-footer"></div>
        </div>
      </div>

      <div class="jb-modal" id="jb-create" role="dialog" aria-modal="true" aria-labelledby="jb-create-title">
        <div class="jb-modal__content">
          <div class="jb-modal__header"><h3 class="jb-modal__title" id="jb-create-title">Nouveau job</h3><button type="button" class="jb-modal__close" id="jb-create-close" aria-label="Fermer">×</button></div>
          <form class="jb-modal__body jb-form" id="jb-form" novalidate>
            <div class="form-group"><label class="form-label form-label--required" for="jb-title">Titre</label><input type="text" class="form-input" id="jb-title" maxlength="200" required></div>
            <div class="form-group"><label class="form-label" for="jb-description">Description</label><textarea class="form-textarea" id="jb-description" rows="4" placeholder="Ce qu’il y a à faire, où exactement…"></textarea></div>
            <div class="form-group"><label class="form-label form-label--required" for="jb-sector">Secteur</label><select class="form-select" id="jb-sector"></select></div>
            <div class="form-group"><label class="form-label" for="jb-trail">Sentier</label><select class="form-select" id="jb-trail"></select></div>
            <div class="form-group"><label class="form-label" for="jb-priority">Priorité</label><select class="form-select" id="jb-priority">${Jobs.PRIORITIES.map(p => `<option value="${p.id}"${p.id === Jobs.DEFAULT_PRIORITY ? ' selected' : ''}>${p.icon} ${p.label}</option>`).join('')}</select></div>
            <p class="jb-sub" id="jb-form-error" style="color:var(--color-danger);display:none" role="alert"></p>
          </form>
          <div class="jb-modal__footer"><button type="button" class="btn btn-secondary" id="jb-create-cancel">Annuler</button><button type="button" class="btn btn-primary" id="jb-create-save">Créer le job</button></div>
        </div>
      </div>`;

    const $ = id => document.getElementById(id);
    let jobs = [], sectors = [], current = null, saving = false;

    // ----- sectors and trails (filters and creation form) -----
    function fillTrailFilter() {
      const sector = SectorService.find(sectors, $('jb-f-sector').value);
      SectorService.fillTrails($('jb-f-trail'), sector, 'Tous les sentiers');
      if (!sector) $('jb-f-trail').replaceChildren(new Option('Tous les sentiers', ''));
    }
    function fillSectors() {
      SectorService.fillSectors($('jb-f-sector'), sectors, 'Tous les secteurs');
      SectorService.fillSectors($('jb-sector'), sectors, '-- Sélectionner un secteur --');
      SectorService.fillTrails($('jb-trail'), null, '-- Tout le secteur / aucun sentier précis --');
    }

    // ----- the list -----
    function filters() {
      return { status: $('jb-f-status').value, priority: $('jb-f-priority').value, sector: $('jb-f-sector').value, trail: $('jb-f-trail').value,
        source: $('jb-f-source').value, mine: $('jb-f-mine').value, from: $('jb-f-from').value, to: $('jb-f-to').value, text: $('jb-f-text').value };
    }
    function visible() {
      const f = filters();
      let list = Jobs.filter(jobs, f);
      // "Mes jobs": the ones I created, or that one of my travaux (Entretien reports) worked on
      if (f.mine === '1') list = list.filter(j => j.createdBy === opts.uid || (j.workLinks || []).some(w => w.builderId === opts.uid));
      if (!admin) list = list.filter(j => j.status !== 'cancelled');
      return Jobs.sort(list, $('jb-sort').value);
    }
    function renderCounters() {
      const base = admin ? jobs : jobs.filter(j => j.status !== 'cancelled');
      const c = Jobs.counts(base);
      const item = (v, l) => `<div class="jb-counter"><div class="jb-counter__value">${v}</div><div class="jb-counter__label">${l}</div></div>`;
      const oldN = base.filter(j => Jobs.isOld(j)).length;
      $('jb-counters').innerHTML = item(c.todo, 'À faire') + item(c.doing, 'En cours') + item(c.highOpen, '🔴 Haute priorité ouverts') + (oldN ? item(oldN, '🟠 Ouverts depuis plus de ' + Jobs.oldDays() + ' j') : '') + item(c.done, 'Faits') + (admin ? item(c.cancelled, 'Annulés') : '');
    }
    // The origin column: a task made from an inspection or a signalisation is a link that opens that report in the small window (js/services/report-peek.js)
    function rowOrigin(j) {
      const label = Jobs.SOURCES[j.sourceApp] || '–';
      if (!j.sourceId || (j.sourceApp !== 'inspections' && j.sourceApp !== 'signalisations') || typeof ReportPeek === 'undefined') return esc(label);
      return `<button type="button" class="jb-link" data-origin="${esc(j.id)}" title="${j.sourceApp === 'inspections' ? 'Voir l’inspection d’origine' : 'Voir la signalisation d’origine'}">${esc(label)}</button>`;
    }
    function row(j) {
      const p = Jobs.priority(j.priority);
      const place = [j.trail, j.sectorName].filter(Boolean);
      const prio = admin
        ? `<button type="button" class="jb-prio jb-prio--admin" data-prio="${esc(j.id)}" title="${esc(p.label)} - cliquer pour changer" aria-label="Priorité ${esc(p.label)}, cliquer pour changer">${p.icon}</button>`
        : `<span class="jb-prio" title="${esc(p.label)}" role="img" aria-label="Priorité ${esc(p.label)}">${p.icon}</span>`;
      const old = Jobs.isOld(j);   // open for too long: light orange line, and how long
      return `<tr data-id="${esc(j.id)}"${old ? ' class="jb-row--old"' : ''}>
        <td data-label="Priorité">${prio}</td>
        <td data-label="Job"><button type="button" class="jb-link" data-open="${esc(j.id)}">${esc(j.title)}</button></td>
        <td data-label="Sentier">${place.length ? `<strong>${esc(place[0])}</strong>${place[1] ? `<span class="jb-sub">${esc(place[1])}</span>` : ''}` : '–'}</td>
        <td data-label="Statut">${pill(j.status)}</td>
        <td data-label="Créé">${esc(fmtDate(j.createdAt))}${old ? `<span class="jb-old" title="Job encore ouvert (à faire ou en cours) depuis plus de ${Jobs.oldDays()} jours"> · ouvert depuis ${Jobs.ageDays(j)} j</span>` : ''}</td>
        <td data-label="Modifié">${esc(fmtDate(j.updatedAt))}</td>
        <td data-label="Origine">${rowOrigin(j)}</td>
      </tr>`;
    }
    function render() {
      renderCounters();
      const list = visible();
      $('jb-tbody').innerHTML = list.map(row).join('');
      $('jb-empty').style.display = list.length ? 'none' : '';
      $('jb-count').textContent = `${list.length} job${list.length > 1 ? 's' : ''}`;
    }
    async function load() {
      const snap = await db.collection('jobs').where('network', '==', Network.current()).get();
      jobs = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(j => Network.matches(j));
      render();
    }

    // ----- the detail window -----
    const field = (label, html) => `<div class="jb-field"><div class="jb-field__label">${esc(label)}</div><div>${html}</div></div>`;
    // The origin of a task: a word, and for an inspection / a signalisation a link that opens the report in a small window (js/services/report-peek.js)
    function originHtml(j) {
      const label = Jobs.SOURCES[j.sourceApp] || '–';
      if (!j.sourceId || (j.sourceApp !== 'inspections' && j.sourceApp !== 'signalisations') || typeof ReportPeek === 'undefined') return esc(label);
      return `${esc(label)} - <button type="button" class="jb-link" data-peek="origin">${j.sourceApp === 'inspections' ? 'voir l’inspection' : 'voir la signalisation'}</button>`;
    }
    // How a task was closed: through the last travail marked "Fait" (a link to that travail), or from the Jobs app (a window with who, when and what was written)
    function closingHtml(j, links) {
      const last = Jobs.lastLink(links);
      const byWork = j.status === 'done' && last && last.status === 'done';
      const who = byWork ? (last.builderName ? ` par ${esc(last.builderName)}` : '') : (j.closedByName ? ` par ${esc(j.closedByName)}` : '');
      const btn = typeof ReportPeek === 'undefined' ? '' : (byWork
        ? ' <button type="button" class="jb-link" data-peek="last-work">voir le travail qui l’a fermé</button>'
        : ' <button type="button" class="jb-link" data-peek="closing">voir les détails</button>');
      return `${esc(fmtDateTime(j.closedAt))}${who}${btn}${j.closingDescription ? `<div class="jb-desc">${esc(j.closingDescription)}</div>` : ''}`;
    }
    function openDetail(id) {
      const j = jobs.find(x => x.id === id);
      if (!j) return;
      current = j;
      const p = Jobs.priority(j.priority);
      const links = Array.isArray(j.workLinks) ? j.workLinks : [];
      $('jb-detail-title').textContent = j.title;
      $('jb-detail-body').innerHTML =
        field('Statut', pill(j.status)) + field('Priorité', `${p.icon} ${esc(p.label)}`) +
        field('Secteur', esc(j.sectorName || '–')) + field('Sentier', esc(j.trail || '–')) +
        field('Description', j.description ? `<div class="jb-desc">${esc(j.description)}</div>` : '<span class="jb-empty">Aucune description.</span>') +
        field('Créé', `${esc(fmtDateTime(j.createdAt))}${j.createdByName ? ` par ${esc(j.createdByName)}` : ''}`) +
        field('Dernière modification', esc(fmtDateTime(j.updatedAt))) +
        field('Origine', originHtml(j)) +
        field('Travaux d’entretien liés', links.length ? `<ul style="margin:0;padding-left:1.1rem">${links.map((l, i) => `<li><button type="button" class="jb-link" data-peek-work="${i}" title="Voir ce travail">${esc(fmtDate(l.date))}${l.builderName ? ` - ${esc(l.builderName)}` : ''}</button>${l.status ? ` (${esc(Jobs.status(l.status).label)})` : ''}${l.text ? `<span class="jb-sub jb-desc">${esc(l.text)}</span>` : ''}</li>`).join('')}</ul>` : '<span class="jb-empty">Aucun travail lié pour l’instant.</span>') +
        (j.status === 'done' || j.status === 'cancelled' ? field(j.status === 'done' ? 'Fermé' : 'Annulé', closingHtml(j, links)) : '');
      const buttons = [];
      if (admin) {
        if (j.status === 'todo') buttons.push(['doing', '▶️ Mettre en cours', 'btn-secondary']);
        if (j.status === 'todo' || j.status === 'doing') { buttons.push(['done', '✅ Marquer comme fait', 'btn-primary']); buttons.push(['cancelled', '🚫 Annuler le job', 'btn-secondary']); }
        if (j.status === 'done' || j.status === 'cancelled') buttons.push(['todo', '↩️ Rouvrir', 'btn-secondary']);
      }
      $('jb-detail-footer').innerHTML = buttons.map(b => `<button type="button" class="btn ${b[2]}" data-set="${b[0]}">${b[1]}</button>`).join('') + '<button type="button" class="btn btn-secondary" id="jb-detail-ok">Fermer</button>';
      $('jb-detail').classList.add('show');
    }
    const closeDetail = () => { $('jb-detail').classList.remove('show'); current = null; };

    // ----- writes (administrator) -----
    const ctx = () => ({ uid: opts.uid, name: opts.name, now: firebase.firestore.FieldValue.serverTimestamp() });
    async function setStatus(job, newStatus) {
      if (saving) return;
      let closing = '';
      if (newStatus === 'done' || newStatus === 'cancelled') {
        const ask = newStatus === 'done' ? 'Marquer ce job comme fait ? Vous pouvez ajouter une description de fermeture (facultatif).' : 'Annuler ce job (il n’est plus nécessaire) ? Vous pouvez dire pourquoi (facultatif).';
        closing = window.prompt(ask, '');
        if (closing === null) return;   // the person changed their mind
      }
      saving = true;
      try {
        const patch = Jobs.statusPatch(newStatus, ctx(), closing);
        if (newStatus === 'todo' || newStatus === 'doing') { patch.closedAt = firebase.firestore.FieldValue.delete(); patch.closedBy = firebase.firestore.FieldValue.delete(); patch.closingDescription = firebase.firestore.FieldValue.delete(); patch.closedByName = firebase.firestore.FieldValue.delete(); }
        await db.collection('jobs').doc(job.id).update(patch);
        closeDetail();
        await load();
        showMessage(newStatus === 'done' ? 'Job marqué comme fait.' : newStatus === 'cancelled' ? 'Job annulé.' : 'Job mis à jour.', 'success', 3000);
      } catch (e) {
        console.error('Jobs:', e);
        showMessage('Le job n’a pas pu être modifié.', 'error', 5000);
      } finally { saving = false; }
    }
    async function cyclePriority(id) {
      const j = jobs.find(x => x.id === id);
      if (!j || saving) return;
      saving = true;
      try {
        await db.collection('jobs').doc(id).update({ priority: Jobs.nextPriority(j.priority), updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: opts.uid });
        await load();
      } catch (e) {
        console.error('Jobs:', e);
        showMessage('La priorité n’a pas pu être changée.', 'error', 5000);
      } finally { saving = false; }
    }

    // ----- creation -----
    function openCreate() {
      $('jb-form').reset();
      SectorService.fillTrails($('jb-trail'), null, '-- Tout le secteur / aucun sentier précis --');
      $('jb-form-error').style.display = 'none';
      $('jb-create').classList.add('show');
      $('jb-title').focus();
    }
    const closeCreate = () => $('jb-create').classList.remove('show');
    async function saveCreate() {
      if (saving) return;
      const sector = SectorService.find(sectors, $('jb-sector').value);
      const trail = SectorService.readTrail($('jb-trail'));
      const input = { title: $('jb-title').value, description: $('jb-description').value, sector: sector ? sector.id : null, sectorName: sector ? sector.name : null,
        trail: trail.name, trailId: trail.id, priority: $('jb-priority').value, sourceApp: 'jobs' };
      const problem = Jobs.validate(input);
      const err = $('jb-form-error');
      if (problem) { err.textContent = problem; err.style.display = ''; return; }
      saving = true;
      $('jb-create-save').disabled = true;
      try {
        await db.collection('jobs').add(Jobs.newJob(input, Object.assign({ network: Network.current() }, ctx())));
        closeCreate();
        await load();
        showMessage('Job créé.', 'success', 3000);
      } catch (e) {
        console.error('Jobs:', e);
        err.textContent = 'Le job n’a pas pu être enregistré. Réessayez dans un moment.';
        err.style.display = '';
      } finally { saving = false; $('jb-create-save').disabled = false; }
    }

    // ----- events -----
    ['jb-f-status', 'jb-f-priority', 'jb-f-trail', 'jb-f-mine', 'jb-f-source', 'jb-f-from', 'jb-f-to', 'jb-sort'].forEach(id => $(id).addEventListener('change', render));
    $('jb-f-sector').addEventListener('change', () => { fillTrailFilter(); render(); });
    $('jb-f-text').addEventListener('input', render);
    $('jb-sector').addEventListener('change', () => SectorService.fillTrails($('jb-trail'), SectorService.find(sectors, $('jb-sector').value), '-- Tout le secteur / aucun sentier précis --'));
    $('jb-new').addEventListener('click', openCreate);
    $('jb-create-close').addEventListener('click', closeCreate);
    $('jb-create-cancel').addEventListener('click', closeCreate);
    $('jb-create-save').addEventListener('click', saveCreate);
    $('jb-form').addEventListener('submit', e => { e.preventDefault(); saveCreate(); });
    $('jb-detail-close').addEventListener('click', closeDetail);
    $('jb-detail').addEventListener('click', e => { if (e.target === $('jb-detail')) closeDetail(); });
    $('jb-create').addEventListener('click', e => { if (e.target === $('jb-create')) closeCreate(); });
    $('jb-detail-body').addEventListener('click', e => {
      if (!current || typeof ReportPeek === 'undefined') return;
      const links = Array.isArray(current.workLinks) ? current.workLinks : [];
      const peek = e.target.closest('[data-peek]'), work = e.target.closest('[data-peek-work]');
      if (work && links[+work.dataset.peekWork]) return ReportPeek.work(current, links[+work.dataset.peekWork]);
      if (!peek) return;
      if (peek.dataset.peek === 'origin') ReportPeek.origin(current);
      else if (peek.dataset.peek === 'last-work') ReportPeek.work(current, Jobs.lastLink(links));
      else if (peek.dataset.peek === 'closing') ReportPeek.closing(current);
    });
    $('jb-detail-footer').addEventListener('click', e => {
      if (e.target.id === 'jb-detail-ok') return closeDetail();
      const set = e.target.closest('[data-set]');
      if (set && current) setStatus(current, set.dataset.set);
    });
    $('jb-tbody').addEventListener('click', e => {
      const open = e.target.closest('[data-open]');
      if (open) return openDetail(open.dataset.open);
      const origin = e.target.closest('[data-origin]');
      if (origin) { const job = jobs.find(x => x.id === origin.dataset.origin); if (job) ReportPeek.origin(job); return; }
      const prio = e.target.closest('[data-prio]');
      if (prio && admin) cyclePriority(prio.dataset.prio);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); closeCreate(); } });

    return Promise.all([SectorService.load().catch(e => { console.error('Jobs: secteurs', e); return []; }), load()]).then(([s]) => { sectors = s; fillSectors(); });
  }

  return { mount };
})();
if (typeof window !== 'undefined') window.JobsView = JobsView;
