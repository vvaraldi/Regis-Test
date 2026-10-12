/**
 * WeatherService - the weather readings of the Météo app: the fields, the values read from Environment Canada,
 * the feels-like temperature, validation, and the records in Firestore (collection `weather_records`).
 *
 * A record keeps BOTH what Environment Canada said and what the person typed:
 *   locationId   the place (config.js APP_CONFIG.weather.locations); one place today
 *   recordedAt   day and time of the reading (Timestamp, editable)
 *   manual       { tempC, ..., sky }  what was typed; null = nothing typed (a typed value replaces the web one)
 *   web          { fetchedAt, fields: { tempC: { value, source, observedAt, publishable }, ... } } or null
 *                source = the station id ('lac', 'sherbrooke') or 'calc' (the feels-like); publishable = may be shown
 *                on the public page (config: station.publish). The web values stay as they were read, so a typed
 *                value can be undone.
 *   comment, createdBy, createdByName, createdAt, modifiedBy, modifiedByName, modifiedAt
 *
 * Needs config.js (APP_CONFIG.weather). Reads Environment Canada with fetch(); the Firestore parts take `db` and
 * the `firebase` namespace like the other services.
 */
const WeatherService = (() => {
  const COLLECTION = 'weather_records';

  // ---- The fields (units: °C, km/h, mm, cm, %, kPa, km) ----
  const CLOUD_COVER = { clear: 'Dégagé', partly: 'Partiellement nuageux', overcast: 'Couvert' };
  const SKY = { sun: 'Soleil', snow: 'Neige', rain: 'Pluie', fog: 'Brouillard' };
  const LISTS = (APP_CONFIG.weather && APP_CONFIG.weather.lists) || {};   // the typed-only choices (config.js)
  // In the order of the form (the customer's priority). windForce, snowType, snowBase and snowCover exist only typed
  // by hand: Environment Canada does not give them.
  const FIELDS = [
    { key: 'tempC', label: 'Température', unit: '°C', type: 'number', min: -60, max: 50, step: 0.1 },
    { key: 'feelsLikeC', label: 'Température ressentie', unit: '°C', type: 'number', min: -90, max: 60, step: 1 },
    { key: 'windForce', label: 'Force du vent', type: 'choice', choices: LISTS.windForce || {}, listed: true },
    { key: 'windKmh', label: 'Vent', unit: 'km/h', type: 'number', min: 0, max: 300, step: 1 },
    { key: 'gustKmh', label: 'Rafales', unit: 'km/h', type: 'number', min: 0, max: 300, step: 1 },
    { key: 'windDir', label: 'Direction du vent', unit: '°', type: 'number', min: 0, max: 360, step: 1 },
    { key: 'newSnowCm', label: 'Neige fraîche (24 h)', unit: 'cm', type: 'number', min: 0, max: 300, step: 1 },
    { key: 'snowType', label: 'Conditions de neige', type: 'choice', choices: LISTS.snowType || {}, listed: true },
    { key: 'snowDepthCm', label: 'Neige au sol (base)', unit: 'cm', type: 'number', min: 0, max: 1000, step: 1 },
    { key: 'snowBase', label: 'Fond', type: 'choice', choices: LISTS.snowBase || {}, listed: true },
    { key: 'snowCover', label: 'Couverture', type: 'choice', choices: LISTS.snowCover || {}, listed: true },
    { key: 'rainMm', label: 'Pluie (24 h)', unit: 'mm', type: 'number', min: 0, max: 500, step: 0.1 },
    { key: 'cloudCover', label: 'Nuages', type: 'choice', choices: CLOUD_COVER },
    { key: 'sky', label: 'Conditions', type: 'choice', choices: SKY },
    { key: 'humidityPct', label: 'Humidité', unit: '%', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'pressureKpa', label: 'Pression', unit: 'kPa', type: 'number', min: 80, max: 110, step: 0.1 },
    { key: 'visibilityKm', label: 'Visibilité', unit: 'km', type: 'number', min: 0, max: 100, step: 0.1 }
  ];  const KEYS = FIELDS.map(f => f.key);
  const fieldOf = key => FIELDS.find(f => f.key === key);

  const config = () => APP_CONFIG.weather;
  const location = id => config().locations[id || config().defaultLocation];

  // ---- Small helpers ----
  const num = v => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const round1 = n => Math.round(n * 10) / 10;
  const ms = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && typeof t.toDate === 'function') ? t.toDate().getTime() : (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : null));

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  /** 297 -> "ONO" (the wind comes from that side) */
  function compass(deg) {
    const d = num(deg);
    return d === null ? '' : COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
  }

  /**
   * The temperature it feels like, with Environment Canada's formulas: wind chill when it is 0 °C or colder and
   * the wind is at least 5 km/h; humidex when it is 20 °C or warmer (needs the dew point); otherwise the air
   * temperature itself. Wind chill and humidex are whole degrees.
   */
  function feelsLike(tempC, windKmh, dewPointC) {
    const t = num(tempC), v = num(windKmh), td = num(dewPointC);
    if (t === null) return null;
    if (t <= 0 && v !== null && v >= 5) {
      const p = Math.pow(v, 0.16);
      return Math.round(13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p);
    }
    if (t >= 20 && td !== null) {
      const e = 6.11 * Math.exp(5417.753 * (1 / 273.16 - 1 / (273.16 + td)));
      const humidex = t + 0.5555 * (e - 10);
      return humidex > t ? Math.round(humidex) : t;
    }
    return t;
  }

  // ---- Environment Canada ----

  /** The cloud cover from the layers' amount codes (1 few, 2 scattered, 3 broken, 4 overcast): none = clear. */
  function cloudCoverFromLayers(codes) {
    const top = Math.max(0, ...codes.map(num).filter(c => c !== null));
    return top === 0 ? 'clear' : (top >= 4 ? 'overcast' : 'partly');
  }

  /**
   * What one station reading (the `properties` of an observation) tells, as { key: value } plus `dewPointC`
   * (only used for the feels-like) - nothing is guessed, a missing measure is simply absent.
   */
  function mapObservation(props, profile) {
    const p = props || {};
    const out = {};
    const put = (key, v) => { if (v !== null && v !== undefined) out[key] = v; };
    const temp = num(p.air_temp);
    put('tempC', temp);
    put('humidityPct', num(p.rel_hum));
    put('windKmh', num(p.avg_wnd_spd_10m_pst10mts));
    put('windDir', num(p.avg_wnd_dir_10m_pst10mts));
    const gust = num(p.max_wnd_spd_10m_pst1hr);
    put('gustKmh', gust !== null ? gust : num(p.max_wnd_spd_10m_pst10mts));
    put('dewPointC', num(p.dwpt_temp));
    if (profile === 'airport') {
      const mslp = num(p.mslp);                                   // hPa -> kPa
      put('pressureKpa', mslp === null ? null : round1(mslp / 10));
      put('visibilityKm', num(p.avg_vis_pst10mts));
      const layers = [p.cld_amt_code_1, p.cld_amt_code_2, p.cld_amt_code_3].filter(c => num(c) !== null);
      // no layer in a complete report (it has its visibility) = clear sky; a report without it tells nothing
      const cover = layers.length ? cloudCoverFromLayers(layers) : (num(p.avg_vis_pst10mts) !== null ? 'clear' : null);
      put('cloudCover', cover);
      const pc24 = num(p.pcpn_amt_pst24hrs);                      // rain only when it is not freezing
      put('rainMm', pc24 !== null && temp !== null && temp > 1 ? pc24 : null);
      // a suggestion for the sky: fog, precipitation (rain / snow by the temperature), otherwise sun when not overcast
      const pc1 = num(p.pcpn_amt_pst1hr), vis = num(p.avg_vis_pst10mts);
      let sky = null;
      if (vis !== null && vis < 1) sky = 'fog';
      else if (pc1 !== null && pc1 > 0 && temp !== null) sky = temp > 1 ? 'rain' : 'snow';
      else if (cover === 'clear' || cover === 'partly') sky = 'sun';
      put('sky', sky);
    }
    return out;
  }

  /** The URL of the latest observation of a station at or before `at`, within `maxAgeHours`. */
  function observationUrl(station, at) {
    const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const to = new Date(at), from = new Date(to.getTime() - config().maxAgeHours * 3600 * 1000);
    return `${config().api}?f=json&msc_id-value=${encodeURIComponent(station.mscId)}&datetime=${iso(from)}/${iso(to)}&sortby=-date_tm-value&limit=1`;
  }

  async function fetchStation(station, at, fetchFn) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
    try {
      const res = await fetchFn(observationUrl(station, at), ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const feature = data && data.features && data.features[0];
      if (!feature) return null;
      const observedAt = Date.parse(feature.properties['date_tm-value']);
      return { observedAt: Number.isFinite(observedAt) ? observedAt : null, values: mapObservation(feature.properties, station.profile) };
    } finally { if (timer) clearTimeout(timer); }
  }

  /**
   * The values Environment Canada can give for a place at a time (default: now).
   * Returns { fields, fetchedAt, observedAt, missing, errors } where
   *   fields    { key: { value, source, observedAt (ms), publishable } }, each from the first station that has it,
   *             plus the computed feels-like (source 'calc')
   *   observedAt  the newest observation used (ms), or null when nothing was available
   *   missing   ids of stations with no observation in the window
   *   errors    [{ station, message }] for stations that could not be read (the others still count)
   * Throws only when EVERY station failed to answer.
   */
  async function fetchWebValues(options) {
    const o = options || {};
    const loc = location(o.locationId);
    const at = o.at ? new Date(o.at) : new Date();
    const fetchFn = o.fetch || ((...a) => window.fetch(...a));
    const results = await Promise.all(loc.stations.map(async station => {
      try { return { station, reading: await fetchStation(station, at, fetchFn) }; }
      catch (e) { return { station, error: (e && e.message) || String(e) }; }
    }));
    if (results.every(r => r.error)) {
      const err = new Error('Environment Canada could not be reached: ' + results.map(r => r.error).join('; '));
      err.code = 'unreachable';
      throw err;
    }
    const fields = {}, dew = {};
    let observedAt = null;
    const missing = [], errors = [];
    results.forEach(r => {
      if (r.error) { errors.push({ station: r.station.id, message: r.error }); return; }
      if (!r.reading) { missing.push(r.station.id); return; }
      const { values, observedAt: seen } = r.reading;
      if (seen !== null && (observedAt === null || seen > observedAt)) observedAt = seen;
      Object.keys(values).forEach(key => {
        if (key === 'dewPointC') { if (!dew.value && dew.value !== 0) { dew.value = values[key]; dew.station = r.station.id; } return; }
        if (!fields[key]) fields[key] = { value: values[key], source: r.station.id, observedAt: seen, publishable: r.station.publish === true };
      });
    });
    // the feels-like from the air temperature we kept (wind and dew point from any station)
    if (fields.tempC) {
      const feel = feelsLike(fields.tempC.value, fields.windKmh && fields.windKmh.value, dew.value);
      if (feel !== null) fields.feelsLikeC = { value: feel, source: 'calc', observedAt: fields.tempC.observedAt, publishable: fields.tempC.publishable };
    }
    return { fields, fetchedAt: Date.now(), observedAt, missing, errors };
  }

  // ---- Validation and records ----

  /**
   * Checks what was typed ({ key: text or number, '' = nothing }). Returns { ok, values, errors } where values has
   * EVERY key (a number, a choice id, or null) and errors maps a key to a French message.
   */
  function validateManual(input) {
    const values = {}, errors = {};
    const raw = input || {};
    FIELDS.forEach(f => {
      const v = raw[f.key];
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) { values[f.key] = null; return; }
      if (f.type === 'choice') {
        if (!Object.prototype.hasOwnProperty.call(f.choices, v)) errors[f.key] = `${f.label} : choix invalide.`;
        else values[f.key] = v;
        return;
      }
      const n = num(typeof v === 'string' ? v.trim().replace(',', '.') : v);
      if (n === null) errors[f.key] = `${f.label} : un nombre est attendu.`;
      else if (n < f.min || n > f.max) errors[f.key] = `${f.label} : entre ${f.min} et ${f.max} ${f.unit || ''}.`.replace(/ \.$/, '.');
      else values[f.key] = n;
    });
    return { ok: Object.keys(errors).length === 0, values, errors };
  }

  const hasAnyValue = (manual, web) =>
    KEYS.some(k => manual && manual[k] !== null && manual[k] !== undefined) || !!(web && web.fields && Object.keys(web.fields).length);

  /** The web part as stored: Timestamps instead of milliseconds. */
  function webForStorage(web, fb) {
    if (!web || !web.fields || !Object.keys(web.fields).length) return null;
    const ts = t => (t === null || t === undefined) ? null : fb.firestore.Timestamp.fromDate(new Date(t));
    const fields = {};
    Object.keys(web.fields).forEach(k => {
      const f = web.fields[k];
      fields[k] = { value: f.value, source: f.source, observedAt: ts(f.observedAt), publishable: f.publishable === true };
    });
    return { fetchedAt: ts(web.fetchedAt), fields };
  }

  /**
   * A new record, ready for Firestore. input: { at (Date), locationId?, manual (what was typed), web (fetchWebValues
   * result or null), comment }. Returns { ok: true, record } or { ok: false, errors }.
   */
  function buildRecord(input, user, fb) {
    const checked = validateManual(input.manual);
    const errors = Object.assign({}, checked.errors);
    const at = input.at instanceof Date ? input.at : new Date(input.at);
    if (!Number.isFinite(at.getTime())) errors.recordedAt = 'La date et l\'heure du relevé sont invalides.';
    if (!errors.recordedAt && !hasAnyValue(checked.values, input.web)) errors.values = 'Entrez au moins une valeur.';
    if (Object.keys(errors).length) return { ok: false, errors };
    const stamp = fb.firestore.FieldValue.serverTimestamp();
    return {
      ok: true,
      record: {
        locationId: input.locationId || config().defaultLocation,
        recordedAt: fb.firestore.Timestamp.fromDate(at),
        manual: checked.values,
        web: webForStorage(input.web, fb),
        comment: (input.comment || '').trim().slice(0, 1000),
        createdBy: user.uid, createdByName: user.name || '', createdAt: stamp,
        modifiedBy: user.uid, modifiedByName: user.name || '', modifiedAt: stamp
      }
    };
  }

  /**
   * What a record says for each field: the typed value, else the web one. { key: { value, source } } with only the
   * fields that have a value. publicOnly: web values that may not be published (the airport's) are left out.
   */
  function effectiveValues(record, options) {
    const publicOnly = !!(options && options.publicOnly);
    const out = {};
    KEYS.forEach(k => {
      const typed = record.manual && record.manual[k];
      if (typed !== null && typed !== undefined) { out[k] = { value: typed, source: 'manual' }; return; }
      const w = record.web && record.web.fields && record.web.fields[k];
      if (w && w.value !== null && w.value !== undefined && (!publicOnly || w.publishable === true)) out[k] = { value: w.value, source: w.source };
    });
    // The web feels-like was computed from the WEB temperature. When a different temperature was typed (and no feels-like
    // typed) it would describe another temperature: it is worked out again from the typed one (wind chill, with the wind
    // we have), or left out from 20 °C up, where the humidex needs a dew point that is not kept.
    const typedTemp = record.manual && record.manual.tempC;
    const typedFeels = record.manual && record.manual.feelsLikeC;
    if (out.feelsLikeC && out.feelsLikeC.source === 'calc' && typedTemp !== null && typedTemp !== undefined && (typedFeels === null || typedFeels === undefined)) {
      const feel = typedTemp >= 20 ? null : feelsLike(typedTemp, out.windKmh ? out.windKmh.value : null, null);
      if (feel === null) delete out.feelsLikeC; else out.feelsLikeC = { value: feel, source: 'calc' };
    }
    return out;
  }

  // ---- Firestore ----

  async function save(db, fb, input, user) {
    const built = buildRecord(input, user, fb);
    if (!built.ok) return built;
    const ref = await db.collection(COLLECTION).add(built.record);
    return { ok: true, id: ref.id, record: built.record };
  }

  /**
   * Corrects a record: any of { at, manual, comment }. The author never changes and the web values are kept as
   * they were read. Returns { ok } or { ok: false, errors }.
   */
  async function update(db, fb, id, current, changes, user) {
    const patch = {};
    const errors = {};
    let manual = current.manual || {};
    if (changes.manual) {
      const checked = validateManual(changes.manual);
      if (!checked.ok) Object.assign(errors, checked.errors); else { manual = checked.values; patch.manual = manual; }
    }
    if (changes.at) {
      const at = changes.at instanceof Date ? changes.at : new Date(changes.at);
      if (!Number.isFinite(at.getTime())) errors.recordedAt = 'La date et l\'heure du relevé sont invalides.'; else patch.recordedAt = fb.firestore.Timestamp.fromDate(at);
    }
    if (changes.comment !== undefined) patch.comment = String(changes.comment || '').trim().slice(0, 1000);
    if (!Object.keys(errors).length && !hasAnyValue(manual, current.web)) errors.values = 'Entrez au moins une valeur.';
    if (Object.keys(errors).length) return { ok: false, errors };
    patch.modifiedBy = user.uid; patch.modifiedByName = user.name || ''; patch.modifiedAt = fb.firestore.FieldValue.serverTimestamp();
    await db.collection(COLLECTION).doc(id).update(patch);
    return { ok: true, patch };
  }

  /** The records between two dates (local time), oldest first, for one place. Only recordedAt is queried (no composite index). */
  async function list(db, fb, from, to, locationId) {
    const snap = await db.collection(COLLECTION)
      .where('recordedAt', '>=', fb.firestore.Timestamp.fromDate(from))
      .where('recordedAt', '<', fb.firestore.Timestamp.fromDate(to))
      .orderBy('recordedAt', 'asc').get();
    const place = locationId || config().defaultLocation;
    const fromMs = from.getTime(), toMs = to.getTime();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => {
      const t = ms(r.recordedAt);
      return t !== null && t >= fromMs && t < toMs && (r.locationId || config().defaultLocation) === place;
    }).sort((a, b) => ms(a.recordedAt) - ms(b.recordedAt));
  }

  /** The records of one day (local time). */
  function listDay(db, fb, day, locationId) {
    const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    return list(db, fb, from, to, locationId);
  }

  /** A value as shown: "12 cm", "297° (ONO)", "Couvert" (decimal comma). */
  function format(key, value) {
    const f = fieldOf(key);
    if (!f) return String(value);
    if (f.type === 'choice') return f.choices[value] || String(value);
    const text = String(value).replace('.', ',');
    if (key === 'windDir') return `${text}° (${compass(value)})`;
    return f.unit ? `${text} ${f.unit}` : text;
  }

  /** Deletes a reading (the rules reserve this to the system admin). */
  function remove(db, id) {
    return db.collection(COLLECTION).doc(id).delete();
  }

  // ---- The public copy of the latest reading (weather_public/latest, read by anyone: see js/services/weather-public.js) ----

  const PUBLIC_COLLECTION = 'weather_public';

  /**
   * The public document of a reading: no names, only the values that may be published (typed values and those of the
   * publishable station - never the airport's). measures = { key: value }; webFields = the keys that came from
   * Environment Canada (so the page can credit it). Returns null when the reading has nothing publishable.
   */
  function publicDocument(record, fb) {
    const eff = effectiveValues(record, { publicOnly: true });
    const keys = Object.keys(eff);
    if (!keys.length) return null;
    const measures = {}, webFields = [];
    const stations = new Set();
    const loc = location(record.locationId);
    keys.forEach(k => {
      // the words of a typed-only list go out as words (the other website has no copy of the lists); the rest as stored
      measures[k] = fieldOf(k).listed ? (fieldOf(k).choices[eff[k].value] || String(eff[k].value)) : eff[k].value;
      if (eff[k].source !== 'manual') {
        webFields.push(k);
        const st = loc.stations.find(s => s.id === eff[k].source);
        if (st) stations.add(st.name);
      }
    });
    return {
      locationId: record.locationId || config().defaultLocation,
      locationName: loc.name,
      recordedAt: record.recordedAt,
      measures,
      webFields,
      attribution: webFields.length ? `Données : Environnement et Changement climatique Canada${stations.size ? ' (' + [...stations].join(', ') + ')' : ''}` : null,
      updatedAt: fb.firestore.FieldValue.serverTimestamp()
    };
  }

  /**
   * Rewrites weather_public/latest from the most recent reading that has something publishable (looking at the 20 most
   * recent), or removes it when there is none. Call it after a reading is saved, corrected or deleted.
   * Returns the public document written, or null.
   */
  async function publishLatest(db, fb) {
    const snap = await db.collection(COLLECTION).orderBy('recordedAt', 'desc').limit(20).get();
    const recent = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.recordedAt) - ms(a.recordedAt));
    const ref = db.collection(PUBLIC_COLLECTION).doc('latest');
    for (const record of recent) {
      const doc = publicDocument(record, fb);
      if (doc) { await ref.set(doc); return doc; }
    }
    await ref.delete();
    return null;
  }

  // ---- For the statistics ----

  /** 2026-01-15 for a date, in local time */
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /**
   * One value per day for a measure: among the day's readings that HAVE a value for it (typed, else web), the one
   * taken closest to noon. Returns [{ day: '2026-01-15', value, at (ms), source }] oldest day first.
   */
  function dailyValues(records, key) {
    const best = new Map();
    records.forEach(r => {
      const v = effectiveValues(r)[key];
      const t = ms(r.recordedAt);
      if (!v || t === null) return;
      const at = new Date(t);
      const noon = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 12).getTime();
      const distance = Math.abs(t - noon);
      const day = dayKey(at);
      if (!best.has(day) || distance < best.get(day).distance) best.set(day, { day, value: v.value, at: t, source: v.source, distance });
    });
    return [...best.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map(({ distance, ...rest }) => rest);
  }

  /**
   * The days WITHOUT any reading among the `count` days ending on `lastDay` (a Date; that day included).
   * Returns their keys, oldest first. The statistics use the 20 days ending yesterday: today is not over yet.
   */
  function missingDays(records, lastDay, count) {
    const have = new Set();
    records.forEach(r => { const t = ms(r.recordedAt); if (t !== null) have.add(dayKey(new Date(t))); });
    const missing = [];
    for (let i = count - 1; i >= 0; i--) {
      const key = dayKey(new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() - i));
      if (!have.has(key)) missing.push(key);
    }
    return missing;
  }

  return {
    COLLECTION, FIELDS, KEYS, CLOUD_COVER, SKY, fieldOf, location,
    compass, format, feelsLike, mapObservation, observationUrl, fetchWebValues,
    validateManual, buildRecord, effectiveValues, save, update, remove, list, listDay,
    publicDocument, publishLatest, dayKey, dailyValues, missingDays
  };
})();
window.WeatherService = WeatherService;
