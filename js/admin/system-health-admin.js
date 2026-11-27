/**
 * SystemHealthAdmin - the "Santé" tab of Administration (system admin only): draws what SystemHealth says.
 * Reads nothing until the tab is opened, then again with "Actualiser".
 * Requires: db, APP_CONFIG, network.js (Network), services/system-health.js; the markup is the #health-tab of user-management.html.
 */
const SystemHealthAdmin = (() => {
  const el = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WORD = { ok: 'OK', warn: 'À voir', bad: 'À corriger', none: 'Info' };
  let started = false, loaded = false, busy = false;

  /** What read() needs on this site: the training site has no backup nor e-mail; the weather is judged while the ski season runs */
  const options = () => ({ training: APP_CONFIG.training === true, projectId: APP_CONFIG.firebase.projectId, skiSeason: Network.seasonRange('ski').active });

  function render(result, at) {
    el('sh-summary').className = 'sh-summary sh-summary--' + result.summary.state;
    el('sh-summary').textContent = result.summary.text;
    el('sh-cards').innerHTML = result.cards.map(c => `<div class="sh-card sh-card--${c.state}" data-card="${c.id}">
      <div class="sh-card__head"><h4 class="sh-card__title">${esc(c.title)}</h4><span class="sh-pill sh-pill--${c.state}">${WORD[c.state]}</span></div>
      <div class="sh-card__big">${esc(c.headline)}</div>
      ${c.lines.map(l => `<div class="sh-card__line">${esc(l)}</div>`).join('')}
      ${c.link ? `<a class="sh-card__link" href="${esc(c.link.href)}" target="_blank" rel="noopener">${esc(c.link.text)}</a>` : ''}
    </div>`).join('');
    el('sh-when').textContent = 'Vérifié à ' + at.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  }

  async function load() {
    if (busy) return;
    busy = true;
    const button = el('sh-refresh');
    button.disabled = true;
    el('sh-when').textContent = 'Vérification…';
    try {
      const input = await SystemHealth.read(db, options());
      const now = new Date();
      render(SystemHealth.evaluate(input, now), now);
      loaded = true;
    } catch (e) {
      console.error('Santé:', e);
      el('sh-summary').className = 'sh-summary sh-summary--bad';
      el('sh-summary').textContent = 'La vérification n’a pas pu se faire : ' + (e.message || e);
    } finally { busy = false; button.disabled = false; }
  }

  function init() {
    if (started) return;
    started = true;
    el('sh-refresh').addEventListener('click', load);
    el('health-tab-btn').addEventListener('click', () => { if (!loaded) load(); });
    // opened by the dot of the portal's Administration tile: user-management.html?tab=health
    if (new URLSearchParams(window.location.search).get('tab') === 'health') { switchTab('health'); load(); }
  }

  return { init, load, options };
})();
