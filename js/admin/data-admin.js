/**
 * data-admin.js - The Admin page of Infractions, Signalisations and Entretien
 * ===========================================================================
 * Two tabs, like Inspections > Admin:
 *   📊 Statistiques        by season (the activity's own season: Network.seasonRange): cards, charts, rankings
 *   🗄️ Gestion des données  (system admin only) database overview, delete old records (with an automatic
 *                          backup download), and the orphan photo clean-up (storage-cleanup.js)
 *
 * Each page only describes its own numbers (see pages/infraction-stats.html and its two siblings):
 *   DataAdmin.init({
 *     fetch({ start, end })   -> Promise<records[]>: the activity's records of the season, normalised
 *     onReady(userData)       -> optional, awaited before the first fetch (load sectors...)
 *     cards:    [{ label, value(recs), sub(recs)?, highlight? }]
 *     charts:   [{ id, title, kind: 'weekly' | 'bar' | 'doughnut' | 'series', label?, data(recs) -> [[name, n], ...],
 *                  limit?, half?, tall?, color? }]       (consecutive `half` charts share a row)
 *               kind 'series' = values in the order given (a value per day), negatives allowed, no sorting:
 *               { type?: 'line' (default) | 'bar', unit?, beginAtZero? }
 *     rankings: [{ title, columns: ['Name', 'Count', ...], rows(recs) -> [[name, n, ...], ...] }]
 *     management: { overview() -> [{ label, value }],
 *                   deleteOld: { noun, find(beforeDate) -> [{ collection, id, data }], remove(item), backupName,
 *                                scope? (words for "which activity", default: the current activity),
 *                                description? (the text above the tool), done()? (awaited once all are deleted) },
 *                   orphanApp?: 'infraction' | 'signalisation' | 'maintenance' (none: an app without photos) }
 *   })
 * A record needs `date` (a Date) for the weekly chart.
 *
 * Needs the page markup of pages/*-stats.html (#admin-root), css/pages/data-admin.css, Chart.js,
 * and config.js, network.js, utils.js, auth.js, photo-service.js, storage-cleanup.js.
 */
const DataAdmin = (function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#64748b'];

  let cfg = null;
  let records = [];
  let offset = 0;
  let range = null;
  const charts = {};

  // ---- Season (same rule as Inspections: Network.seasonRange, config.js `season`) -------------------------------
  function seasonBounds(n) {
    const current = Network.seasonRange();
    const isCurrent = n === 0;
    const start = new Date(current.start.getFullYear() - n, current.start.getMonth(), current.start.getDate());
    const end = isCurrent && current.active
      ? new Date()
      : new Date(current.end.getFullYear() - n, current.end.getMonth(), current.end.getDate());
    end.setHours(23, 59, 59, 999);
    return { start, end, isCurrent, active: isCurrent && current.active };
  }

  function earliestSeasonStart() {
    const e = APP_CONFIG.earliestSeasonStart;
    return new Date(e.year, e.month - 1, e.day);
  }

  function seasonLabel(bounds) {
    const fmt = d => d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
    if (bounds.isCurrent) return Network.seasonLabel(bounds);
    const years = bounds.start.getFullYear() === bounds.end.getFullYear()
      ? String(bounds.start.getFullYear())
      : `${bounds.start.getFullYear()}-${bounds.end.getFullYear()}`;
    return `Saison ${years} (${fmt(bounds.start)} – ${fmt(bounds.end)})`;
  }

  function applySeason() {
    range = seasonBounds(offset);
    $('da-season-label').textContent = seasonLabel(range);
    $('da-season-next').disabled = range.isCurrent;
    $('da-season-prev').disabled = seasonBounds(offset + 1).start < earliestSeasonStart();
  }

  async function changeSeason(delta) {
    const next = offset + delta;
    if (next < 0 || seasonBounds(next).start < earliestSeasonStart()) return;
    offset = next;
    applySeason();
    $('da-season-prev').disabled = true; // no overlapping reads on a double click
    $('da-season-next').disabled = true;
    await refresh();
    applySeason();
  }

  // ---- Messages -----------------------------------------------------------------------------------------
  function message(text, type) {
    $('da-success').classList.remove('show');
    $('da-error').classList.remove('show');
    if (!text) return;
    const box = type === 'error' ? $('da-error') : $('da-success');
    box.textContent = text;
    box.classList.add('show');
  }

  // ---- Shell ---------------------------------------------------------------------------------------------
  function buildShell() {
    const m = cfg.management;
    $('admin-root').innerHTML = `
      <div class="alert alert-success" id="da-success"></div>
      <div class="alert alert-danger" id="da-error"></div>
      <div class="tabs">
        <button type="button" class="tab-btn active" data-tab="statistics">📊 Statistiques</button>
        <button type="button" class="tab-btn" data-tab="management" id="da-tab-management" style="display: none;">🗄️ Gestion des données</button>
      </div>

      <div class="tab-content active" id="da-pane-statistics">
        <div class="season-nav">
          <button type="button" class="season-nav__btn" id="da-season-prev" aria-label="Saison précédente" title="Saison précédente">◀</button>
          <span class="season-nav__label" id="da-season-label">-</span>
          <button type="button" class="season-nav__btn" id="da-season-next" aria-label="Saison suivante" title="Saison suivante" disabled>▶</button>
        </div>
        <div id="da-notice"></div>
        <div class="stats-grid" id="da-cards"></div>
        <div id="da-charts"></div>
        <div id="da-rankings"></div>
      </div>

      <div class="tab-content" id="da-pane-management">
        <div class="management-section">
          <div class="management-section__title">📊 État de la base de données</div>
          <div class="management-section__desc" id="da-overview-desc"></div>
          <div class="db-stats" id="da-overview"></div>
        </div>
        <div class="management-section management-section--danger">
          <div class="management-section__title">🗑️ Supprimer les anciennes données</div>
          <div class="management-section__desc" id="da-delete-desc"></div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="da-delete-before">Supprimer avant le</label>
              <input type="date" class="form-input" id="da-delete-before">
            </div>
            <div class="form-group" style="flex: 0 0 auto;">
              <button type="button" class="btn btn-danger" id="da-delete-btn" disabled>Supprimer</button>
            </div>
          </div>
          <div id="da-delete-preview" style="margin-top: 1rem; display: none;">
            <p style="color: var(--color-danger); font-weight: 500;"><span id="da-delete-count">0</span> enregistrement(s) seront supprimé(s)<span id="da-delete-photos"> avec leurs photos</span>.</p>
          </div>
        </div>
        <div id="da-orphans"></div>
      </div>`;

    $('da-overview-desc').textContent = m.overviewNote || 'Aperçu de TOUTES les données stockées, tous réseaux confondus (Ski et Vélo) - pas seulement l\'activité actuelle.';

    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $(`da-pane-${btn.dataset.tab}`).classList.add('active'); // (the button is da-tab-*, the panel da-pane-*)
    }));
    $('da-season-prev').addEventListener('click', () => changeSeason(1));
    $('da-season-next').addEventListener('click', () => changeSeason(-1));
    $('da-delete-before').addEventListener('change', previewDelete);
    $('da-delete-btn').addEventListener('click', deleteOld);
  }

  // ---- Statistics ------------------------------------------------------------------------------------------
  async function refresh() {
    try {
      records = await cfg.fetch({ start: range.start, end: range.end });
    } catch (error) {
      console.error('Error loading the statistics:', error);
      records = [];
      message('Erreur lors du chargement des données', 'error');
    }
    // Each part on its own: one that fails does not take the others down
    [['cartes', renderCards], ['graphiques', renderCharts], ['classements', renderRankings]].forEach(([name, draw]) => {
      try { draw(); } catch (error) {
        console.error(`Error drawing the ${name}:`, error);
        message(`Impossible d'afficher les ${name} : ${error.message}`, 'error');
      }
    });
  }

  function renderCards() {
    $('da-cards').innerHTML = cfg.cards.map(card => {
      const sub = card.sub ? card.sub(records) : '';
      return `<div class="stat-card${card.highlight ? ' stat-card--highlight' : ''}">
        <div class="stat-card__label">${escapeHtml(card.label)}</div>
        <div class="stat-card__value">${escapeHtml(String(card.value(records)))}</div>
        ${sub ? `<div class="stat-card__sub">${escapeHtml(String(sub))}</div>` : ''}
      </div>`;
    }).join('');
  }

  const weekStart = date => {
    const d = new Date(date);
    const day = d.getDay();
    return new Date(d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)));
  };

  function chartData(def) {
    if (def.kind === 'weekly') {
      const weeks = {};
      records.forEach(r => {
        if (!r.date) return;
        const key = weekStart(r.date).toISOString().split('T')[0];
        weeks[key] = (weeks[key] || 0) + 1;
      });
      const keys = Object.keys(weeks).sort();
      return keys.map(k => [new Date(k).toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' }), weeks[k]]);
    }
    if (def.kind === 'series') return def.data(records);
    const pairs = def.data(records).filter(p => p[1] > 0).sort((a, b) => b[1] - a[1]);
    return def.limit ? pairs.slice(0, def.limit) : pairs;
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') throw new Error('la bibliothèque de graphiques (Chart.js) n\'est pas chargée');
    const root = $('da-charts');
    if (!root.dataset.built) {
      // One block per chart; consecutive `half` charts share a row
      let html = '', row = [];
      const flush = () => { if (row.length) { html += `<div class="chart-row">${row.join('')}</div>`; row = []; } };
      cfg.charts.forEach(def => {
        const block = `<div class="chart-section">
          <div class="chart-section__title">${escapeHtml(def.title)}</div>
          <div class="chart-container${def.tall ? ' chart-container--tall' : ''}" id="da-box-${def.id}"><canvas id="da-chart-${def.id}"></canvas></div>
        </div>`;
        if (def.half) { row.push(block); if (row.length === 2) flush(); } else { flush(); html += block; }
      });
      flush();
      root.innerHTML = html;
      root.dataset.built = '1';
    }

    cfg.charts.forEach(def => {
      const pairs = chartData(def);
      const box = $(`da-box-${def.id}`);
      if (charts[def.id]) { charts[def.id].destroy(); charts[def.id] = null; }
      if (!pairs.length) {
        box.innerHTML = '<p class="chart-empty">Aucune donnée pour cette saison</p>';
        return;
      }
      if (!$(`da-chart-${def.id}`)) box.innerHTML = `<canvas id="da-chart-${def.id}"></canvas>`; // an empty render removed it
      const ctx = $(`da-chart-${def.id}`).getContext('2d');
      const labels = pairs.map(p => (p[0].length > 28 ? p[0].substring(0, 28) + '…' : p[0]));
      const values = pairs.map(p => p[1]);
      const base = { responsive: true, maintainAspectRatio: false };
      if (def.kind === 'weekly') {
        charts[def.id] = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: def.label || 'Total', data: values, borderColor: def.color || '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.3 }] },
          options: Object.assign({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }, base) });
      } else if (def.kind === 'series') {
        const bar = def.type === 'bar';
        charts[def.id] = new Chart(ctx, { type: bar ? 'bar' : 'line',
          data: { labels, datasets: [Object.assign({ label: def.label || 'Valeur', data: values, borderColor: def.color || '#3b82f6', backgroundColor: bar ? (def.color || '#3b82f6') : 'rgba(59, 130, 246, 0.1)' },
            bar ? {} : { fill: false, tension: 0.2, pointRadius: 2, spanGaps: true })] },
          options: Object.assign({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${def.label || 'Valeur'} : ${c.parsed.y}${def.unit ? ' ' + def.unit : ''}` } } },
            scales: { y: { beginAtZero: def.beginAtZero !== false && bar ? true : !!def.beginAtZero, title: { display: !!def.unit, text: def.unit || '' } }, x: { ticks: { maxTicksLimit: 14, autoSkip: true } } } }, base) });
      } else if (def.kind === 'doughnut') {
        charts[def.id] = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ data: values, backgroundColor: PALETTE }] },
          options: Object.assign({ plugins: { legend: { position: 'bottom' } } }, base) });
      } else {
        charts[def.id] = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: def.label || 'Total', data: values, backgroundColor: def.color || '#3b82f6' }] },
          options: Object.assign({ indexAxis: def.horizontal ? 'y' : 'x', plugins: { legend: { display: false } }, scales: { [def.horizontal ? 'x' : 'y']: { beginAtZero: true, ticks: { stepSize: 1 } } } }, base) });
      }
    });
  }

  function renderRankings() {
    $('da-rankings').innerHTML = cfg.rankings.map((def, k) => {
      const rows = def.rows(records);
      const head = ['Rang', ...def.columns].map((c, i) => `<th${i >= 2 ? ' class="num"' : ''}${i === 0 ? ' style="width: 60px;"' : ''}>${escapeHtml(c)}</th>`).join('');
      const body = rows.length
        ? rows.map((row, i) => {
            const rank = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
            return `<tr><td><span class="rank-badge ${rank}">${i + 1}</span></td>` +
              row.map((cell, c) => `<td${c >= 1 ? ' class="num"' : ''}${c === 1 ? ' style="font-weight: 600;"' : ''}>${escapeHtml(String(cell))}</td>`).join('') + '</tr>';
          }).join('')
        : `<tr><td colspan="${def.columns.length + 1}" class="chart-empty">Aucune donnée pour cette saison</td></tr>`;
      return `<div class="chart-section"><div class="chart-section__title">${escapeHtml(def.title)}</div>
        <div style="overflow-x: auto;"><table class="data-table" id="da-ranking-${k}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
    }).join('');
  }

  // ---- Management ---------------------------------------------------------------------------------------
  async function loadOverview() {
    try {
      const items = await cfg.management.overview();
      $('da-overview').innerHTML = items.map(i => `<div class="db-stat"><div class="db-stat__value">${escapeHtml(String(i.value))}</div><div class="db-stat__label">${escapeHtml(i.label)}</div></div>`).join('');
    } catch (error) {
      console.error('Error loading the database overview:', error);
    }
  }

  const beforeDate = () => {
    const value = $('da-delete-before').value;
    if (!value) return null;
    const d = new Date(value);
    d.setHours(23, 59, 59, 999);
    return d;
  };

  async function previewDelete() {
    const before = beforeDate();
    if (!before) { $('da-delete-preview').style.display = 'none'; $('da-delete-btn').disabled = true; return; }
    const items = await cfg.management.deleteOld.find(before);
    $('da-delete-count').textContent = items.length;
    $('da-delete-preview').style.display = 'block';
    $('da-delete-btn').disabled = items.length === 0;
  }

  async function deleteOld() {
    const before = beforeDate();
    const spec = cfg.management.deleteOld;
    if (!before) return;
    if (!window.confirm(`Êtes-vous sûr de vouloir supprimer ${spec.noun} ${spec.scope || `de l'activité « ${Network.config().name} »`} avant le ${before.toLocaleDateString('fr-CA')}?\n\nUn fichier de sauvegarde sera téléchargé automatiquement.\n\nCette action est IRRÉVERSIBLE.`)) return;
    try {
      message('Création de la sauvegarde...', 'success');
      const items = await spec.find(before);
      if (!items.length) { message('Rien à supprimer.', 'success'); return; }

      // Backup first (Firestore Timestamps become ISO dates)
      const backup = { exportDate: new Date().toISOString(), beforeDate: before.toISOString(), count: items.length, records: items.map(i => ({ collection: i.collection, id: i.id, ...i.data })) };
      const json = JSON.stringify(backup, (key, value) => (value && typeof value === 'object' && value.seconds !== undefined && value.nanoseconds !== undefined ? new Date(value.seconds * 1000).toISOString() : value), 2);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${spec.backupName}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      let deleted = 0;
      for (const item of items) {
        await spec.remove(item); // its photos, then the record itself
        deleted++;
        if (deleted % 10 === 0) message(`Suppression : ${deleted}/${items.length}...`, 'success');
      }
      if (spec.done) await spec.done();   // e.g. Météo: the public copy of the latest reading follows
      message(`${deleted} enregistrement(s) supprimé(s) avec succès. Sauvegarde téléchargée.`, 'success');
      await refresh();
      await loadOverview();
      await previewDelete();
    } catch (error) {
      console.error('Error deleting:', error);
      message('Erreur lors de la suppression: ' + error.message, 'error');
    }
  }

  // ---- Start ----------------------------------------------------------------------------------------------------
  function init(config) {
    cfg = config;
    buildShell();
    checkAuthStatus({
      requireAuth: true,
      requiredRoles: ['admin', 'system_admin'],
      onAuthenticated: async (userData) => {
        // (needs the activity, known only now)
        const deleteSpec = cfg.management.deleteOld;
        if (!cfg.management.orphanApp) $('da-delete-photos').hidden = true;   // no photos in this app
        $('da-delete-desc').textContent = deleteSpec.description
          || `Supprime ${deleteSpec.noun} et leurs photos avant la date spécifiée, pour l'activité « ${Network.config().name} » uniquement. Un fichier de sauvegarde sera téléchargé automatiquement avant la suppression.`;
        if (cfg.notice) { const text = cfg.notice(); if (text) $('da-notice').innerHTML = `<div class="alert alert-warning show">${escapeHtml(text)}</div>`; }
        // Data management first, and on its own: a problem drawing the statistics (a chart script that
        // did not load, say) must never hide the clean-up tools. Deleting is reserved to the system admin
        // (the Firestore and Storage rules say the same).
        if (userData.role === 'system_admin') {
          $('da-tab-management').style.display = '';
          if (!cfg.management.orphanApp) {
            // an app without photos (Météo): no orphan clean-up
          } else if (typeof StorageCleanup === 'undefined') {
            $('da-orphans').innerHTML = '<div class="alert alert-danger show">Outil de nettoyage indisponible : le fichier js/services/storage-cleanup.js n\'est pas chargé (déploiement incomplet ou cache : rechargez la page avec Ctrl+F5).</div>';
          } else {
            StorageCleanup.mount($('da-orphans'), cfg.management.orphanApp, { onDone: loadOverview });
          }
        }
        try {
          if (cfg.onReady) await cfg.onReady(userData);
          applySeason();
          await refresh();
        } catch (error) {
          console.error('Error drawing the statistics:', error);
          message('Erreur lors de l\'affichage des statistiques : ' + error.message, 'error');
        }
        if (userData.role === 'system_admin') await loadOverview();
      },
      onAccessDenied: () => { window.location.href = cfg.deniedUrl || '../index.html'; }
    });
  }

  return { init, records: () => records, refresh, seasonBounds };
})();
window.DataAdmin = DataAdmin;
