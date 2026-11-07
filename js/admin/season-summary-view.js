/**
 * season-summary-view.js - the "Bilan de saison" tab of the Administration page (pages/user-management.html)
 * =========================================================================================================
 * Draws the season summary of the CURRENT activity inside an element: a season navigator, a "Calculer le bilan" button and the figures.
 * NOTHING is read from the database until the button is pressed (changing the season afterwards calculates the new one). The calculation
 * itself is js/services/season-summary.js (pure, tested with arrays); this file reads the season's documents and draws them.
 *
 *   SeasonSummaryView.mount(document.getElementById('summary-root'));
 *
 * Needs: Network, APP_CONFIG, TrailService, SeasonSummary, the global `db`. Printing: the button uses the browser's print window; while it is
 * open the page carries the class `ssv-printing`, which hides everything but the summary (see the style injected below).
 */
const SeasonSummaryView = (function () {
  'use strict';

  const STYLE = `
    .ssv-nav { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .ssv-nav__btn { min-width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--theme-border); border-radius: var(--radius-md); background: var(--theme-surface); color: var(--theme-text); cursor: pointer; font-size: 1rem; }
    .ssv-nav__btn:hover:not(:disabled) { border-color: var(--theme-accent); color: var(--theme-accent); }
    .ssv-nav__btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .ssv-nav__label { font-weight: 600; font-size: 0.95rem; text-align: center; min-width: 260px; }
    .ssv-actions { display: flex; justify-content: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .ssv-section { background: var(--theme-surface); border: 1px solid var(--theme-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.5rem; break-inside: avoid; }
    .ssv-section__title { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.25rem; }
    .ssv-section__note { font-size: 0.8125rem; color: var(--theme-text-secondary); margin-bottom: 1rem; }
    .ssv-figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; margin-bottom: 1rem; }
    .ssv-figure { background: var(--theme-surface-alt); border-radius: var(--radius-md); padding: 0.75rem; text-align: center; }
    .ssv-figure__value { font-size: 1.5rem; font-weight: 700; color: var(--theme-accent); }
    .ssv-figure__label { font-size: 0.75rem; color: var(--theme-text-secondary); }
    .ssv-two-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
    .ssv-sub { font-size: 0.95rem; margin: 0 0 0.5rem; }
    .ssv-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .ssv-table th, .ssv-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--theme-border); }
    .ssv-table th { background: var(--theme-surface-alt); color: var(--theme-text-secondary); font-weight: 600; }
    .ssv-table td.num, .ssv-table th.num { text-align: right; white-space: nowrap; }
    .ssv-good { color: var(--color-success); font-weight: 600; }
    .ssv-bad { color: var(--color-danger); font-weight: 600; }
    .ssv-empty { color: var(--theme-text-secondary); font-size: 0.875rem; }
    .ssv-error { color: var(--color-danger); font-size: 0.875rem; }
    .ssv-footnote { font-size: 0.75rem; color: var(--theme-text-secondary); margin-top: 1rem; }
    .ssv-print-title { display: none; }
    @media (max-width: 768px) {
      .ssv-nav__label { min-width: 0; }
      .ssv-table { font-size: 0.8125rem; }
      .ssv-table th, .ssv-table td { padding: 0.4rem 0.5rem; }
      .ssv-section { padding: 1rem; }
    }
    @media print {
      body.ssv-printing header, body.ssv-printing nav, body.ssv-printing footer, body.ssv-printing .mobile-nav, body.ssv-printing .page-header,
      body.ssv-printing .admin-tabs, body.ssv-printing .ssv-no-print, body.ssv-printing #occasion-banner, body.ssv-printing .occasion-banner, body.ssv-printing .occasion-fx { display: none !important; }
      body.ssv-printing .ssv-print-title { display: block; margin-bottom: 1rem; }
      body.ssv-printing { background: #fff !important; color: #000 !important; }
      body.ssv-printing .ssv-section { border: 1px solid #bbb; box-shadow: none; }
    }`;

  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const fmtNum = n => (n === null || n === undefined ? '–' : String(n).replace('.', ','));
  const earliest = () => new Date(APP_CONFIG.earliestSeasonStart.year, APP_CONFIG.earliestSeasonStart.month - 1, APP_CONFIG.earliestSeasonStart.day);
  const canGoBack = offset => SeasonSummary.bounds(offset).start >= earliest();
  // "2026-2027" (ski) or "2026" (bike), from the season's own first and last day (also for a running season, which is counted only up to today)
  const shortSeason = b => (b.start.getFullYear() === b.seasonEnd.getFullYear() ? String(b.start.getFullYear()) : `${b.start.getFullYear()}-${b.seasonEnd.getFullYear()}`);
  function seasonText(b) {
    const fmt = d => d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
    if (b.isCurrent) return Network.seasonLabel(b);
    return `Saison ${shortSeason(b)} (${fmt(b.start)} – ${fmt(b.end)})`;
  }

  // ----- drawing helpers -----
  const section = (title, note, body) => `<section class="ssv-section"><h2 class="ssv-section__title">${title}</h2>${note ? `<div class="ssv-section__note">${note}</div>` : ''}${body}</section>`;
  const figures = list => `<div class="ssv-figures">${list.map(f => `<div class="ssv-figure"><div class="ssv-figure__value">${fmtNum(f.value)}${f.unit || ''}</div><div class="ssv-figure__label">${esc(f.label)}</div></div>`).join('')}</div>`;
  const table = (head, rows, numFrom) => rows.length
    ? `<div style="overflow-x:auto"><table class="ssv-table"><thead><tr>${head.map((h, i) => `<th class="${i >= numFrom ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i >= numFrom ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<div class="ssv-empty">Rien à afficher pour cette saison.</div>';
  const unavailable = what => `<div class="ssv-error">${esc(what)} n’a pas pu être lu pour le moment.</div>`;

  function deltaCell(row, prevRow) {
    if (!prevRow || row.value === null || prevRow.value === null || typeof row.value !== 'number' || typeof prevRow.value !== 'number') return '–';
    const diff = Math.round((row.value - prevRow.value) * 10) / 10;
    if (diff === 0) return '=';
    const text = (diff > 0 ? '+' : '−') + fmtNum(Math.abs(diff)) + (row.unit || '');
    const good = row.higherIsBetter === undefined ? null : (diff > 0) === row.higherIsBetter;
    return good === null ? text : `<span class="${good ? 'ssv-good' : 'ssv-bad'}">${text}</span>`;
  }

  function mount(root) {
    if (!root || root.dataset.ssvMounted) return;
    root.dataset.ssvMounted = '1';
    if (!document.getElementById('ssv-style')) {
      const st = document.createElement('style');
      st.id = 'ssv-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    root.innerHTML = `
      <h1 class="ssv-print-title" id="ssv-print-title"></h1>
      <p class="ssv-section__note ssv-no-print" id="ssv-activity"></p>
      <div class="ssv-nav ssv-no-print">
        <button type="button" class="ssv-nav__btn" id="ssv-prev" aria-label="Saison précédente" title="Saison précédente">◀</button>
        <span class="ssv-nav__label" id="ssv-label">-</span>
        <button type="button" class="ssv-nav__btn" id="ssv-next" aria-label="Saison suivante" title="Saison suivante" disabled>▶</button>
      </div>
      <div class="ssv-actions ssv-no-print">
        <button type="button" class="btn btn-primary btn-sm" id="ssv-compute">📊 Calculer le bilan</button>
        <button type="button" class="btn btn-secondary btn-sm" id="ssv-print" disabled>🖨️ Imprimer / enregistrer en PDF</button>
      </div>
      <div id="ssv-body"><div class="ssv-empty" id="ssv-intro">Choisissez la saison, puis appuyez sur « Calculer le bilan ». Rien n’est lu dans la base de données avant.</div></div>
      <p class="ssv-footnote">Les jours sont des jours civils. Une saison en cours est comptée jusqu’à aujourd’hui.</p>`;
    const $ = id => document.getElementById(id);
    let seasonOffset = 0, trailList = [], busy = false, computed = false, shelters = null;

    async function shelterList() {
      if (shelters) return shelters;
      shelters = [];
      if (Network.feature('shelters')) {
        const snap = await db.collection('shelters').get();
        snap.forEach(d => { const s = Object.assign({ id: d.id }, d.data()); if (Network.matches(s) && !TrailService.isArchived(s)) shelters.push(s); });
      }
      return shelters;
    }

    /** Reads what one season needs. A collection that cannot be read gives null (its section says so) instead of stopping everything. */
    async function loadSeason(b) {
      const ts = d => firebase.firestore.Timestamp.fromDate(d);
      const between = (name, field) => db.collection(name).where(field, '>=', ts(b.start)).where(field, '<=', ts(b.end)).get()
        .then(snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data())))
        .catch(e => { console.warn('Bilan: could not read ' + name, e); return null; });
      const ids = new Set(trailList.map(t => t.id));
      const shelterIds = new Set((await shelterList()).map(s => s.id));
      const [trailInsp, shelterInsp, log, weather, maintenance] = await Promise.all([
        between('trail_inspections', 'date'),
        Network.feature('shelters') ? between('shelter_inspections', 'date') : Promise.resolve([]),
        between('status_log', 'at'),
        Network.feature('weather') ? between('weather_records', 'recordedAt') : Promise.resolve(null),
        Network.current() === 'bike' ? between('maintenance_logs', 'date') : Promise.resolve(null)
      ]);
      const mine = list => (list ? list.filter(x => Network.matches(x)) : null);
      return SeasonSummary.compute({
        range: { start: b.start, end: b.end }, now: new Date(),
        trails: trailList,
        trailInspections: trailInsp ? trailInsp.filter(i => ids.has(i.trail_id)) : [],
        shelterInspections: shelterInsp ? shelterInsp.filter(i => shelterIds.has(i.shelter_id)) : [],
        statusLog: mine(log), weather,
        maintenance: mine(maintenance)
      });
    }

    function render(cur, prev, b, pb) {
      const parts = [];
      const keyRows = SeasonSummary.highlights(cur);
      const prevRows = prev ? SeasonSummary.highlights(prev) : null;
      parts.push(section('Chiffres clés', pb ? `Cette saison (${esc(shortSeason(b))}) et la saison précédente (${esc(shortSeason(pb))}).` : 'Pas de saison précédente à comparer.',
        table(['', shortSeason(b)].concat(pb ? [shortSeason(pb), 'Écart'] : []),
          keyRows.map(r => { const p = prevRows && prevRows.find(x => x.id === r.id); return [esc(r.label), `${fmtNum(r.value)}${r.value === null ? '' : r.unit}`].concat(pb ? [p ? `${fmtNum(p.value)}${p.value === null ? '' : p.unit}` : '–', deltaCell(r, p)] : []); }), 1)));

      const I = cur.inspections;
      parts.push(section('Inspections', '', figures([
        { label: 'Inspections', value: I.total }, { label: 'Sentiers', value: I.trail },
        Network.feature('shelters') ? { label: 'Abris', value: I.shelter } : null,
        { label: 'Photos', value: I.photos }, { label: 'Avec problèmes', value: I.withIssuesPct, unit: ' %' }, { label: 'Inspecteurs actifs', value: I.inspectors }
      ].filter(Boolean)) + `<div class="ssv-two-cols"><div><h3 class="ssv-sub">Par mois</h3>${table(['Mois', 'Inspections'], I.byMonth.map(m => [esc(m.label), m.count]), 1)}</div>
        <div><h3 class="ssv-sub">Problèmes les plus fréquents</h3>${table(['Problème', 'Fois'], I.topIssues.map(x => [esc(x.label), x.count]), 1)}
        <h3 class="ssv-sub" style="margin-top:1rem">Inspecteurs les plus actifs</h3>${table(['Inspecteur', 'Inspections'], I.topInspectors.map(x => [esc(x.label), x.count]), 1)}</div></div>`));

      const C = cur.coverage;
      parts.push(section('Couverture des sentiers', 'Combien de sentiers ont été visités, et à quel rythme.', figures([
        { label: 'Sentiers', value: C.trails }, { label: 'Inspectés au moins une fois', value: C.pct, unit: ' %' },
        { label: 'Jours entre deux inspections (moyenne)', value: C.avgGapDays, unit: ' j' }
      ]) + `<div class="ssv-two-cols"><div><h3 class="ssv-sub">Jamais inspectés cette saison</h3>${C.never.length ? `<div>${C.never.map(esc).join(', ')}</div>` : '<div class="ssv-empty">Tous les sentiers ont été inspectés au moins une fois. 👍</div>'}</div>
        <div><h3 class="ssv-sub">Plus longue période sans inspection</h3>${C.longestGap ? `<div><strong>${esc(C.longestGap.name)}</strong> : ${C.longestGap.days} jour${C.longestGap.days > 1 ? 's' : ''}</div>` : '<div class="ssv-empty">–</div>'}</div></div>`));

      const L = cur.closures;
      parts.push(section('Fermetures et statuts', 'D’après le journal de Régis gère.', !L ? unavailable('Le journal des statuts') : figures([
        { label: 'Changements de statut', value: L.changes }, { label: 'Fermetures', value: L.closures }, { label: 'Ouvertures', value: L.openings },
        { label: 'Jours de fermeture (total)', value: L.closedDays, unit: ' j' }
      ]) + '<h3 class="ssv-sub">Recommandations de l’inspection</h3>' + figures([
        { label: 'Acceptées', value: L.accepted }, { label: 'Refusées', value: L.ignored }, { label: 'Part acceptée', value: L.acceptedPct, unit: ' %' }
      ]) + `<h3 class="ssv-sub">Sentiers les plus longtemps fermés</h3>${table(['Sentier', 'Fermetures', 'Jours fermé'], L.topClosed.map(x => [esc(x.name), x.closures, fmtNum(x.closedDays)]), 1)}`));

      if (Network.feature('weather')) {
        const W = cur.weather;
        parts.push(section('Météo', 'À partir des relevés saisis dans l’application Météo.', !W ? unavailable('Les relevés météo') : figures([
          { label: 'Relevés', value: W.readings }, { label: 'Jours avec relevé', value: W.days },
          { label: 'Température la plus basse', value: W.minTemp, unit: ' °C' }, { label: 'Température la plus haute', value: W.maxTemp, unit: ' °C' },
          { label: 'Neige fraîche cumulée', value: W.newSnowCm, unit: ' cm' }, { label: 'Neige au sol maximale', value: W.maxDepthCm, unit: ' cm' }
        ]) + '<div class="ssv-section__note">La neige fraîche cumulée additionne, pour chaque jour, le relevé le plus élevé de la journée.</div>'));
      }

      const M = cur.maintenance;
      if (M) parts.push(section('Entretien', 'Compté en jours (il n’y a pas de pointage des heures).', figures([
        { label: 'Jours d’entretien', value: M.days }, { label: 'Rapports d’entretien', value: M.reports },
        { label: 'Personnes différentes', value: M.people }, { label: 'Jours de travail (total des personnes)', value: M.personDays }
      ])));

      $('ssv-body').innerHTML = parts.join('');
    }

    // The season shown in the navigator (label and print title), without reading anything
    function showLabel() {
      const b = SeasonSummary.bounds(seasonOffset);
      $('ssv-label').textContent = seasonText(b);
      $('ssv-print-title').textContent = `Bilan de saison - ${Network.config().name} - ${seasonText(b)}`;
      $('ssv-activity').textContent = `Activité : ${Network.config().name} (pour l’autre activité, utilisez le sélecteur en haut de la page).`;
      $('ssv-prev').disabled = busy || !canGoBack(seasonOffset + 1);
      $('ssv-next').disabled = busy || seasonOffset === 0;
      return b;
    }

    /** Reads and calculates: only when the button is pressed (or when the season is changed after a first calculation). */
    async function show() {
      if (busy) return;
      busy = true;
      computed = true;
      $('ssv-compute').disabled = $('ssv-print').disabled = true;
      const b = showLabel();
      $('ssv-body').innerHTML = '<div class="ssv-empty">Calcul en cours…</div>';
      try {
        if (!trailList.length) {
          const snap = await db.collection('trails').get();
          snap.forEach(d => { const t = Object.assign({ id: d.id }, d.data()); if (Network.matches(t) && TrailService.isActive(t)) trailList.push(t); });
        }
        const pb = canGoBack(seasonOffset + 1) ? SeasonSummary.bounds(seasonOffset + 1) : null;
        const [cur, prev] = await Promise.all([loadSeason(b), pb ? loadSeason(pb) : Promise.resolve(null)]);
        render(cur, prev, b, pb);
        $('ssv-print').disabled = false;
      } catch (e) {
        console.error('Bilan:', e);
        $('ssv-body').innerHTML = '<div class="ssv-error">Le bilan n’a pas pu être calculé. Réessayez dans un moment.</div>';
      } finally {
        busy = false;
        $('ssv-compute').disabled = false;
        $('ssv-compute').textContent = '📊 Calculer à nouveau';
        showLabel();
      }
    }

    const change = delta => { if (busy) return; seasonOffset += delta; computed ? show() : showLabel(); };
    $('ssv-prev').addEventListener('click', () => { if (canGoBack(seasonOffset + 1)) change(1); });
    $('ssv-next').addEventListener('click', () => { if (seasonOffset > 0) change(-1); });
    $('ssv-compute').addEventListener('click', show);
    $('ssv-print').addEventListener('click', () => {
      document.body.classList.add('ssv-printing');
      const done = () => { document.body.classList.remove('ssv-printing'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      window.print();
    });
    showLabel();
  }

  return { mount };
})();
if (typeof window !== 'undefined') window.SeasonSummaryView = SeasonSummaryView;
