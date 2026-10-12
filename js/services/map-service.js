/**
 * map-service.js - The map images and GPS positions
 * ==================================================
 * Each map (APP_CONFIG.maps: ski, ski-downhill, ski-downhill-geo, bike) has its own image and a GPS
 * calibration: 3 or 4 control points (a pixel on the image + the GPS position of
 * that spot). From them this converts a GPS position to a pixel on the image and
 * back. An activity's own map is APP_CONFIG.networks[id].map; the functions below
 * take a map id, an activity id (its main map), or nothing (the current activity's).
 *
 * Two methods, chosen by the system admin (Administration > Cartes):
 *   'affine'       3 points. For a flat map drawn to scale (ski map).
 *   'perspective'  4 points. For a map drawn in perspective (a projective transform).
 *
 * The calibration of a map is Firestore maps/{map id}:
 *   { mode, points: [{x, y, lat, lon}], width, height }
 * written by the Cartes page, and used only if width/height still match the map in
 * config.js. Without one, canLocate() is false and gpsToPixel() returns null; callers then
 * fall back to a Google Maps link.
 *
 * load() reads Firestore once; it starts by itself when the user is known
 * ("networkReady"). Until it is done nothing can be located.
 *
 * Requires config.js (APP_CONFIG) and network.js (Network).
 */
const MapService = (function () {
  'use strict';

  const MODES = { affine: 3, perspective: 4 }; // mode -> number of control points
  const transforms = {};                        // map id -> transform or null
  const stored = {};                            // map id -> Firestore document data
  let loading = null;

  // ---- Maths ---------------------------------------------------------------------------

  // Solves a x = b (Gaussian elimination, partial pivoting); null if the system is singular
  function solve(a, b) {
    const n = b.length;
    const m = a.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
      if (Math.abs(m[pivot][col]) < 1e-9) return null;
      [m[col], m[pivot]] = [m[pivot], m[col]];
      for (let r = col + 1; r < n; r++) {
        const f = m[r][col] / m[col][col];
        for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = m[r][n];
      for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
      x[r] = s / m[r][r];
    }
    return x;
  }

  // Inverse of a 3x3 matrix (adjugate); null if singular
  function invert3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) return null;
    return [
      (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
      (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
      (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det
    ];
  }

  const isNumber = v => typeof v === 'number' && isFinite(v);

  /**
   * Fits a transform through the control points. Returns { mode, lat0, lon0, scale, h, inv }
   * or { error: 'message in French' }. GPS values are centred and scaled first so the
   * equations are well conditioned (a few metres are 0.00001 degrees).
   */
  function fit(points, mode) {
    const need = MODES[mode];
    if (!need) return { error: 'Méthode inconnue.' };
    const pts = (points || []).slice(0, need);
    if (pts.length < need) return { error: `Il faut ${need} points.` };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (![p.x, p.y, p.lat, p.lon].every(isNumber)) return { error: `Point ${i + 1} : position sur la carte ou GPS incomplet.` };
      if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return { error: `Point ${i + 1} : coordonnées GPS invalides.` };
    }

    const lat0 = pts.reduce((s, p) => s + p.lat, 0) / need;
    const lon0 = pts.reduce((s, p) => s + p.lon, 0) / need;
    const scale = Math.max(...pts.map(p => Math.max(Math.abs(p.lat - lat0), Math.abs(p.lon - lon0))));
    if (!(scale > 0)) return { error: 'Les points GPS sont identiques.' };
    const geo = pts.map(p => ({ X: (p.lon - lon0) / scale, Y: (p.lat - lat0) / scale }));

    let h; // h1..h8 (h9 = 1): [h1 h2 h3; h4 h5 h6; h7 h8 1] maps (X, Y, 1) to (x*w, y*w, w)
    if (mode === 'affine') {
      const hx = solve(geo.map(g => [g.X, g.Y, 1]), pts.map(p => p.x));
      const hy = solve(geo.map(g => [g.X, g.Y, 1]), pts.map(p => p.y));
      if (!hx || !hy) return { error: 'Les 3 points sont alignés : choisissez des points qui forment un triangle.' };
      h = [...hx, ...hy, 0, 0];
    } else {
      const rows = [], rhs = [];
      geo.forEach((g, i) => {
        const { x, y } = pts[i];
        rows.push([g.X, g.Y, 1, 0, 0, 0, -x * g.X, -x * g.Y]); rhs.push(x);
        rows.push([0, 0, 0, g.X, g.Y, 1, -y * g.X, -y * g.Y]); rhs.push(y);
      });
      h = solve(rows, rhs);
      if (!h) return { error: 'Les 4 points ne conviennent pas (points alignés, ou ordre croisé ?). Choisissez 4 points bien répartis et faites le tour du secteur sans croiser les lignes.' };
    }

    const t = { mode, lat0, lon0, scale, h, inv: invert3([...h, 1]) };
    // A perspective fit through points in a bad order (crossed quadrilateral) puts some of
    // them "behind" the camera: refuse it.
    if (!t.inv || pts.some(p => !apply(t, p.lat, p.lon))) {
      return { error: 'Configuration impossible : essayez de placer les points dans un autre ordre (contour du quadrilatère, sans croisement).' };
    }
    return t;
  }

  /** GPS -> pixel on the image (not rounded, not clamped); null if it cannot be placed. */
  function apply(t, lat, lon) {
    if (!t || t.error || !isNumber(lat) || !isNumber(lon)) return null;
    const X = (lon - t.lon0) / t.scale, Y = (lat - t.lat0) / t.scale;
    const [h1, h2, h3, h4, h5, h6, h7, h8] = t.h;
    const w = h7 * X + h8 * Y + 1;
    if (w <= 1e-9) return null;
    return { x: (h1 * X + h2 * Y + h3) / w, y: (h4 * X + h5 * Y + h6) / w };
  }

  /** Pixel on the image -> GPS; null if it cannot be computed. */
  function unapply(t, x, y) {
    if (!t || t.error || !t.inv || !isNumber(x) || !isNumber(y)) return null;
    const i = t.inv;
    const w = i[6] * x + i[7] * y + i[8];
    if (Math.abs(w) < 1e-12) return null;
    const X = (i[0] * x + i[1] * y + i[2]) / w, Y = (i[3] * x + i[4] * y + i[5]) / w;
    return { lat: t.lat0 + Y * t.scale, lon: t.lon0 + X * t.scale };
  }

  // ---- The calibration of each activity ---------------------------------------------------

  // Every function below takes a map id ('ski', 'ski-downhill', 'ski-downhill-geo', 'bike'), or an activity id
  // (that activity's main map), or nothing (the current activity's main map).
  function keyOf(id) {
    const key = id || Network.current();
    const network = APP_CONFIG.networks[key];
    return network ? network.map : key;
  }

  function mapOf(id) {
    return APP_CONFIG.maps[keyOf(id)] || null;
  }

  /**
   * The calibration in force for a map: { mode, points, updatedAt } or null.
   * A calibration saved for another image size is ignored: { stale: true } is returned
   * instead (the map has to be calibrated again).
   */
  function definition(mapId) {
    const id = keyOf(mapId);
    const map = mapOf(id);
    const doc = stored[id];
    if (!doc || !MODES[doc.mode] || !Array.isArray(doc.points)) return null;
    if (map && doc.width === map.width && doc.height === map.height) {
      return { mode: doc.mode, points: doc.points.map(p => ({ ...p })), updatedAt: doc.updatedAt || null };
    }
    return { mode: null, points: null, stale: true };
  }

  function transformFor(mapId) {
    const id = keyOf(mapId);
    if (id in transforms) return transforms[id];
    const def = definition(id);
    const t = def && def.points ? fit(def.points, def.mode) : null;
    return (transforms[id] = t && !t.error ? t : null);
  }

  /** Reads the saved calibrations from Firestore (once). Safe to call several times. */
  function load(force) {
    if (loading && !force) return loading;
    loading = (async () => {
      if (!window.db) return;
      try {
        const snapshot = await window.db.collection('maps').get();
        Object.keys(stored).forEach(id => delete stored[id]);
        snapshot.forEach(doc => { stored[doc.id] = doc.data(); });
      } catch (error) {
        console.warn('MapService: saved calibrations could not be read.', error);
      }
      Object.keys(transforms).forEach(id => delete transforms[id]);
    })();
    return loading;
  }

  /** Saves a calibration (system admin; see the Firestore rules). Returns the fitted transform. */
  async function save(mapId, mode, points, userId) {
    const key = keyOf(mapId);
    const map = mapOf(key);
    if (!map || !map.width || !map.height) throw new Error('Cette carte n\'a pas de taille définie dans la configuration.');
    const clean = (points || []).slice(0, MODES[mode] || 0).map(p => ({ x: Math.round(p.x), y: Math.round(p.y), lat: p.lat, lon: p.lon }));
    const t = fit(clean, mode);
    if (t.error) throw new Error(t.error);
    const data = {
      mode, points: clean, width: map.width, height: map.height,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: userId || null
    };
    await window.db.collection('maps').doc(key).set(data);
    stored[key] = { ...data, updatedAt: new Date() };
    delete transforms[key];
    return t;
  }

  // ---- Used by the pages ------------------------------------------------------------------

  /** Can GPS positions be drawn on this network's map? */
  function canLocate(networkId) {
    return transformFor(networkId) !== null;
  }

  /** Pixel of a GPS position on the map, rounded and clamped to the image; null if the map has no calibration. */
  function gpsToPixel(lat, lon, networkId) {
    const t = transformFor(networkId);
    const p = t && apply(t, lat, lon);
    if (!p) return null;
    const map = mapOf(networkId);
    return { x: Math.max(0, Math.min(map.width, Math.round(p.x))), y: Math.max(0, Math.min(map.height, Math.round(p.y))) };
  }

  /** GPS position of a pixel of the map; null if the map has no calibration. */
  function pixelToGps(x, y, networkId) {
    return unapply(transformFor(networkId), x, y);
  }

  /** URL of the map image, valid from the current page. */
  function imageUrl(networkId) {
    const map = mapOf(networkId);
    return map && map.image ? Network.url(map.image) : '';
  }

  /**
   * Points a map <img> at the current network's map. If the image file is missing
   * (a network whose map has not been provided yet) the image is hidden and a notice
   * is shown; markers are hidden by the .map-wrapper.is-missing rule (helpers.css).
   * The image must sit inside its .map-wrapper.
   */
  function showImage(image, mapId) {
    const wrapper = image.parentElement;
    image.onerror = () => {
      image.style.display = 'none';
      wrapper.classList.add('is-missing');
      if (!wrapper.querySelector('.map-missing')) {
        const notice = document.createElement('p');
        notice.className = 'map-missing';
        notice.style.cssText = 'padding: 2rem; color: var(--theme-text-secondary);';
        notice.textContent = 'Carte non disponible pour cette activité.';
        wrapper.appendChild(notice);
      }
    };
    image.onload = () => {
      image.style.display = '';
      wrapper.classList.remove('is-missing');
      const notice = wrapper.querySelector('.map-missing');
      if (notice) notice.remove();
    };
    const map = mapOf(mapId);
    image.alt = `Carte ${map ? map.name : ''}`.trim();
    image.src = imageUrl(mapId);
  }

  /**
   * The maps the report locations (infractions, signalisations) can be shown on for an activity
   * (networks.<id>.reportMaps). `default` is the first one: for ski the downhill map, shown even
   * before it is calibrated (its positions then wait for the calibration, and the switch offers
   * the other map). `usable` are those that have a GPS calibration.
   */
  function reportMaps(networkId) {
    const network = APP_CONFIG.networks[networkId || Network.current()];
    const ids = (network && network.reportMaps) || (network ? [network.map] : []);
    return { all: ids, default: ids[0] || null, usable: ids.filter(id => canLocate(id)) };
  }

  // The calibrations are read as soon as the user (and so Firestore) is ready
  if (typeof document !== 'undefined') document.addEventListener('networkReady', () => load());

  return { MODES, keyOf, mapOf, fit, apply, unapply, definition, load, save, canLocate, gpsToPixel, pixelToGps, imageUrl, showImage, reportMaps };
})();
window.MapService = MapService;
