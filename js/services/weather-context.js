/**
 * WeatherContext - the weather shown when a report is opened (Gestion pages of Inspections, Infractions,
 * Signalisations and Entretien): the reading NEAREST IN TIME to the report, with the day and time it was recorded.
 *
 * Nothing is copied into the report: the reading is looked up each time, so a corrected reading shows corrected.
 * An admin can switch it off (Météo > Admin: "Afficher la météo dans les rapports", stored in weather_settings/config
 * as { showInReports }) to limit the reads of the database. To spare reads further:
 *   - the switch is remembered for 10 minutes in the browser (a change takes up to 10 minutes to reach the others)
 *   - a reading already looked up for a report time is not looked up again during the visit
 * A reading farther than 12 hours from the report is not offered (the box says there is none).
 * Missing settings document = shown. Any failure (rules not published, no connection) = nothing is shown.
 *
 *   WeatherContext.attach(container, reportDate, { reference?: 'le rapport' })   // call it right after the report is drawn
 *
 * Needs weather-service.js (and config.js); uses the page's `db` and `firebase`.
 */
const WeatherContext = (() => {
  const SETTINGS = ['weather_settings', 'config'];
  const CACHE_KEY = 'orford-weather-settings';
  const CACHE_MS = 10 * 60 * 1000;
  const WINDOW_MS = 12 * 3600 * 1000;
  const DEFAULT_SHOW = true;
  const WS = () => WeatherService;
  const memory = new Map();       // report time (minute) -> Promise of the nearest reading

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && typeof t.toDate === 'function') ? t.toDate().getTime() : (t instanceof Date ? t.getTime() : t);
  const gap = d => { const m = Math.round(Math.abs(d) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

  // ---- the switch ----

  function cached() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY));
      return c && Date.now() - c.at < CACHE_MS ? c : null;
    } catch (e) { return null; }
  }
  function remember(value) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ value, at: Date.now() })); } catch (e) { /* private mode: no cache */ }
  }

  /** The switch as stored (no memory): true unless an admin switched it off. Throws when it cannot be read. */
  async function readSetting(db) {
    const snap = await db.collection(SETTINGS[0]).doc(SETTINGS[1]).get();
    return snap.exists ? snap.data().showInReports !== false : DEFAULT_SHOW;
  }

  /** Is the weather shown in reports? (one read of the settings, then remembered 10 minutes) */
  async function showInReports(db) {
    const c = cached();
    if (c) return c.value;
    try {
      const value = await readSetting(db);
      remember(value);
      return value;
    } catch (e) {
      console.error('Weather settings:', e);
      return false;                // nothing is shown when the settings cannot be read
    }
  }

  /** Saves the switch (admins only, by the rules). */
  async function saveSettings(db, fb, settings, user) {
    await db.collection(SETTINGS[0]).doc(SETTINGS[1]).set({
      showInReports: settings.showInReports !== false,
      updatedAt: fb.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.uid, updatedByName: user.name || ''
    });
    remember(settings.showInReports !== false);
  }

  // ---- the nearest reading ----

  /** { record, delta (ms: negative = before the report) } for the reading nearest to `at` within 12 hours, or null. */
  function nearest(db, fb, at) {
    const key = Math.round(at.getTime() / 60000);
    if (!memory.has(key)) {
      memory.set(key, WS().list(db, fb, new Date(at.getTime() - WINDOW_MS), new Date(at.getTime() + WINDOW_MS + 1)).then(records => {
        let best = null;
        records.forEach(r => {
          const delta = ms(r.recordedAt) - at.getTime();
          if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { record: r, delta };
        });
        return best;
      }).catch(e => { memory.delete(key); throw e; }));
    }
    return memory.get(key);
  }

  // ---- drawing it ----

  const SHORT = { windForce: 'Force du vent', snowType: 'Conditions de neige', snowBase: 'Fond', snowCover: 'Couverture', windKmh: 'Vent', gustKmh: 'Rafales', rainMm: 'Pluie 24 h', newSnowCm: 'Neige fraîche 24 h', snowDepthCm: 'Neige au sol', cloudCover: 'Nuages', sky: 'Conditions', visibilityKm: 'Visibilité', humidityPct: 'Humidité', pressureKpa: 'Pression' };

  /** The values of a reading as one line: typed values first-class, an airport estimate marked ≈ */
  function valuesText(record) {
    const eff = WS().effectiveValues(record);
    const mark = k => (eff[k].source === 'sherbrooke' ? '≈ ' : '');
    const parts = [];
    if (eff.tempC) parts.push(`Température ${mark('tempC')}${WS().format('tempC', eff.tempC.value)}${eff.feelsLikeC && eff.feelsLikeC.value !== eff.tempC.value ? ` (ressentie ${WS().format('feelsLikeC', eff.feelsLikeC.value)})` : ''}`);
    else if (eff.feelsLikeC) parts.push(`Température ressentie ${WS().format('feelsLikeC', eff.feelsLikeC.value)}`);
    WS().KEYS.forEach(k => {
      if (!eff[k] || k === 'tempC' || k === 'feelsLikeC' || k === 'windDir') return;
      if (k === 'windKmh') parts.push(`Vent ${mark(k)}${WS().format('windKmh', eff.windKmh.value)}${eff.windDir ? ' ' + WS().compass(eff.windDir.value) : ''}`);
      else parts.push(`${SHORT[k]} ${mark(k)}${WS().format(k, eff[k].value)}`);
    });
    return { text: parts.join(' · '), estimated: Object.values(eff).some(v => v.source === 'sherbrooke') };
  }

  function boxHtml(found, options) {
    const o = options || {};
    const icon = (typeof Network !== 'undefined' && Network.seasonIcon) ? Network.seasonIcon() : '🌦️';
    const ref = o.reference || 'le rapport';
    const ofRef = ref === 'le rapport' ? 'du rapport' : `de ${ref}`;           // "du rapport", "de midi"
    if (!found) return `<div class="wxc wxc--none"><strong>${icon} Météo</strong> · Aucun relevé météo à moins de 12 h ${esc(ofRef)}.</div>`;
    const when = new Date(ms(found.record.recordedAt));
    const rel = Math.abs(found.delta) < 120000 ? `au moment ${ofRef}` : `${gap(found.delta)} ${found.delta < 0 ? 'avant' : 'après'} ${ref}`;
    const v = valuesText(found.record);
    return `<div class="wxc"><div class="wxc__head"><strong>${icon} Météo</strong> · relevé du ${esc(when.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }))} à ${esc(when.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }))} <span class="wxc__rel">(${esc(rel)})</span></div>
      <div class="wxc__values">${esc(v.text)}</div>${v.estimated ? '<div class="wxc__note">≈ valeur estimée à partir de l\'aéroport de Sherbrooke</div>' : ''}</div>`;
  }

  const CSS = `
    .wxc { background: var(--theme-surface-alt, #f3f4f6); border: 1px solid var(--theme-border, #e5e7eb); border-left: 4px solid var(--color-meteo, #ca8a04); border-radius: 8px; padding: 0.6rem 0.8rem; margin-bottom: 1rem; font-size: 0.9rem; }
    .wxc--none { color: var(--theme-text-secondary, #6b7280); }
    .wxc__rel, .wxc__note { color: var(--theme-text-secondary, #6b7280); font-size: 0.8rem; }
    .wxc__values { margin-top: 0.25rem; }`;

  function injectStyles() {
    if (document.getElementById('wxc-styles')) return;
    const s = document.createElement('style');
    s.id = 'wxc-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /**
   * Puts the weather box at the top of a report view once it is drawn. Quiet by design: switched off, no date, or any
   * failure = nothing added (a report must always open). options: { reference: 'le rapport' (the wording after
   * "avant" / "après"), db, fb }.
   */
  async function attach(container, at, options) {
    if (!container || !at) return;
    const o = options || {};
    const db = o.db || window.db, fb = o.fb || window.firebase;
    const token = String(Date.now() + Math.random());
    container.dataset.wxcToken = token;                      // an older, slower call must not draw over a newer report
    container.querySelectorAll(':scope > .wxc').forEach(n => n.remove());
    try {
      if (!(await showInReports(db))) return;
      const found = await nearest(db, fb, at instanceof Date ? at : new Date(ms(at)));
      if (container.dataset.wxcToken !== token) return;
      injectStyles();
      container.insertAdjacentHTML('afterbegin', boxHtml(found, o));
    } catch (e) {
      console.error('Weather in the report:', e);
    }
  }

  return { attach, showInReports, readSetting, saveSettings, nearest, boxHtml, valuesText, injectStyles, DEFAULT_SHOW, WINDOW_MS, _reset: () => { memory.clear(); try { sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ } } };
})();
window.WeatherContext = WeatherContext;
