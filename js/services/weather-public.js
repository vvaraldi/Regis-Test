/**
 * WeatherPublic - the PUBLIC side of the Météo app: the latest published reading and how to show it.
 *
 * The app keeps one public document, `weather_public/latest` (no names; only values that may be published: typed
 * values and the lake station's, never the airport's), rewritten each time a reading is saved. Two ways to read it:
 *   - on our own public page (pages/public-status.html): the Firestore SDK, live (fromSdk)
 *   - from any other website (for example montorford.com): the plain web address of Firestore's REST API
 *       WeatherPublic.restUrl()   ->  https://firestore.googleapis.com/v1/projects/<project>/databases/(default)/documents/weather_public/latest
 *     fetchLatest() reads it and fromRest() turns Firestore's typed JSON into a simple object (see METEO_APP.md).
 *
 * The simple object ("plain"): { locationName, recordedAt (ISO text), measures: { tempC: -12, ... }, webFields: [...],
 *   attribution: text or null (kept in the data, never shown by the panel) }. panelHtml(plain) draws it; injectStyles() adds the small stylesheet it needs.
 *
 * This file stands alone (no other script needed) so another website can simply copy it.
 */
const WeatherPublic = (() => {
  const CLOUD = { clear: 'Dégagé', partly: 'Partiellement nuageux', overcast: 'Couvert' };
  const SKY = { sun: 'Soleil', snow: 'Neige', rain: 'Pluie', fog: 'Brouillard' };
    const OLD_AFTER_MS = 36 * 3600 * 1000;      // a reading older than this is shown as old

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => String(Math.round(Number(v) * 10) / 10).replace('.', ',');
  const has = (m, k) => m[k] !== undefined && m[k] !== null;
  
  // ---- reading the document ----

  /** The web address of the latest reading in Firestore's REST API (no key needed: the rules make it public). */
  function restUrl(projectId) {
    const id = projectId || (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.firebase && APP_CONFIG.firebase.projectId);
    return `https://firestore.googleapis.com/v1/projects/${id}/databases/(default)/documents/weather_public/latest`;
  }

  /** Firestore REST's typed value ({ doubleValue: 1.5 }, { mapValue: { fields } } ...) as a plain JavaScript value */
  function fromRestValue(v) {
    if (v === null || typeof v !== 'object') return v;
    if ('nullValue' in v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromRestValue);
    if ('mapValue' in v) {
      const out = {};
      Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => { out[k] = fromRestValue(x); });
      return out;
    }
    return null;
  }

  function normalise(raw) {
    if (!raw || !raw.recordedAt) return null;
    return {
      locationName: raw.locationName || '',
      recordedAt: raw.recordedAt,
      measures: raw.measures || {},
      webFields: Array.isArray(raw.webFields) ? raw.webFields : [],
      attribution: raw.attribution || null
    };
  }

  /** The REST answer for the document (what the web address returns) as a plain object; null when there is no reading */
  function fromRest(doc) {
    if (!doc || !doc.fields) return null;
    return normalise(fromRestValue({ mapValue: { fields: doc.fields } }));
  }

  /** The Firestore SDK's data (recordedAt is a Timestamp) as the same plain object */
  function fromSdk(data) {
    if (!data || !data.recordedAt) return null;
    const t = data.recordedAt;
    const iso = typeof t.toDate === 'function' ? t.toDate().toISOString() : new Date(t).toISOString();
    return normalise(Object.assign({}, data, { recordedAt: iso }));
  }

  /** Reads the latest reading through the REST address. Resolves to the plain object, or null when none is published. */
  async function fetchLatest(projectId, fetchFn) {
    const res = await (fetchFn || ((...a) => window.fetch(...a)))(restUrl(projectId));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return fromRest(await res.json());
  }

  // ---- drawing it ----

  const isOld = (plain, now) => (now || Date.now()) - new Date(plain.recordedAt).getTime() > OLD_AFTER_MS;

  /** "15 janvier 2026 à 12 h 00" */
  function whenText(plain) {
    const d = new Date(plain.recordedAt);
    return `${d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })} à ${d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`;
  }

  /**
   * The weather panel as HTML. options: { icon (the season's symbol), now (ms, tests) }.
   * The 11 measures of the Météo app, in ONE row on a wide screen (it wraps on a phone): the temperature (and the feels-like), the wind
   * (km/h and force), every snow condition (fresh snow, depth on the ground, conditions, fond, couverture), the clouds and the general
   * conditions. Only what exists is shown, always with the day and time of the reading. No source line.
   */
  function panelHtml(plain, options) {
    const o = options || {};
    const m = plain.measures;
    const tiles = [];
    // word: a typed word (Poudreuse légère, Fort...) is smaller than a number
    const tile = (label, big, sub, word) => tiles.push(`<div class="wxp-tile"><div class="wxp-tile__label">${esc(label)}</div><div class="wxp-tile__value${word ? ' wxp-tile__value--word' : ''}">${big}</div>${sub ? `<div class="wxp-tile__sub">${sub}</div>` : ''}</div>`);

    if (has(m, 'tempC')) {
      tile('Température', `${esc(num(m.tempC))} °C`, has(m, 'feelsLikeC') && m.feelsLikeC !== m.tempC ? `Ressentie ${esc(num(m.feelsLikeC))} °C` : '');
    } else if (has(m, 'feelsLikeC')) {
      tile('Température ressentie', `${esc(num(m.feelsLikeC))} °C`, '');
    }
    if (has(m, 'windKmh') || has(m, 'windForce')) {
      // the force is typed words (Faible, Moyen, Fort...), published as words
      const subs = [];
      if (has(m, 'windKmh') && has(m, 'windForce')) subs.push(`Force : ${esc(m.windForce)}`);
      tile('Vent', has(m, 'windKmh') ? `${esc(num(m.windKmh))} km/h` : esc(m.windForce), subs.join(' · '), !has(m, 'windKmh'));
    }
    // every snow condition is a tile of its own: fresh snow, depth, conditions, fond, couverture
    if (has(m, 'newSnowCm')) tile('Neige fraîche (24 h)', `${esc(num(m.newSnowCm))} cm`, '');
    if (has(m, 'snowDepthCm')) tile('Neige au sol', `${esc(num(m.snowDepthCm))} cm`, '');
    if (has(m, 'snowType')) tile('Conditions de neige', esc(m.snowType), '', true);
    if (has(m, 'snowBase')) tile('Fond', esc(m.snowBase), '', true);
    if (has(m, 'snowCover')) tile('Couverture', esc(m.snowCover), '', true);
    if (has(m, 'cloudCover')) tile('Nuages', esc(m.cloudCover), '', true);
    if (has(m, 'sky')) tile('Conditions générales', esc(m.sky), '', true);

    const old = isOld(plain, o.now);
    return `<div class="wxp${old ? ' wxp--old' : ''}">
      <div class="wxp__head"><span class="wxp__title">${esc(o.icon || '🌦️')} Météo${plain.locationName ? ' · ' + esc(plain.locationName) : ''}</span>
        <span class="wxp__when">Relevé du ${esc(whenText(plain))}${old ? ' (ancien)' : ''}</span></div>
      ${tiles.length ? `<div class="wxp__tiles">${tiles.join('')}</div>` : '<div class="wxp__empty">Aucune valeur à afficher.</div>'}
    </div>`;
  }

  // The tiles share one row as long as they fit (up to nine of at least 105 px: a full screen, the page being 1100 px wide), then wrap
  const CSS = `
    .wxp { background: var(--theme-surface, #fff); color: var(--theme-text, #1f2937); border: 1px solid var(--theme-border, #e5e7eb); border-radius: 12px; padding: 0.85rem 1rem; margin-bottom: 1rem; font-family: inherit; }
    .wxp--old { opacity: 0.75; }
    .wxp__head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem 1rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
    .wxp__title { font-weight: 700; font-size: 1.05rem; }
    .wxp__when { font-size: 0.85rem; color: var(--theme-text-light, #6b7280); }
    .wxp__tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(105px, 1fr)); gap: 0.5rem; }
    .wxp-tile { background: var(--theme-surface-alt, #f3f4f6); border-radius: 10px; padding: 0.55rem 0.7rem; min-width: 0; }
    .wxp-tile__label { font-size: 0.75rem; color: var(--theme-text-light, #6b7280); }
    .wxp-tile__value { font-size: 1.35rem; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
    .wxp-tile__value--word { font-size: 1.05rem; }
    .wxp-tile__sub { font-size: 0.78rem; color: var(--theme-text-light, #6b7280); }
    .wxp__empty { color: var(--theme-text-light, #6b7280); }`;
  /** Adds the panel's stylesheet to the page (once) */
  function injectStyles() {
    if (document.getElementById('wxp-styles')) return;
    const style = document.createElement('style');
    style.id = 'wxp-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  return { restUrl, fromRestValue, fromRest, fromSdk, fetchLatest, isOld, whenText, panelHtml, injectStyles, CSS, OLD_AFTER_MS };
})();
if (typeof window !== 'undefined') window.WeatherPublic = WeatherPublic;
