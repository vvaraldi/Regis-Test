/**
 * map-calibration.js - Administration > Cartes (system admin)
 * ============================================================
 * Calibrates the GPS <-> pixel conversion of each map (ski, ski-downhill, ski-downhill-geo, bike), with 3 points
 * (flat map, "affine") or 4 points (map in perspective). A control point is a spot
 * you click on the map plus its GPS position (long-press it in Google Maps).
 *
 * What you see before saving, all computed live from the points typed in:
 *   - the numbered control points on the map;
 *   - a GPS grid (lines of latitude and longitude), which shows how the map is bent;
 *   - "Tester une position GPS": where a GPS position lands on the map;
 *   - the GPS position under the pointer when you click on the map.
 * The conversion itself lives in MapService (js/services/map-service.js); this file is
 * only the page. Saved to Firestore maps/{network}.
 *
 * Needs the markup of the "maps" tab in pages/user-management.html.
 */
const MapCalibration = (function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_POINTS = 4;
  const $ = id => document.getElementById(id);
  const blank = () => ({ x: null, y: null, lat: null, lon: null });

  const state = {
    network: null,
    mode: 'affine',
    points: Array.from({ length: MAX_POINTS }, blank),
    placing: null,   // index of the point whose position the next click on the map sets
    test: null,      // { lat, lon } of the test position
    dirty: false
  };
  let userId = null;
  let transform = null; // the live fit (or { error })

  // state.network holds the id of a map (APP_CONFIG.maps): 'ski', 'ski-downhill', 'bike'
  const mapConfig = () => APP_CONFIG.maps[state.network];
  const usedPoints = () => state.points.slice(0, MapService.MODES[state.mode]);
  const fmt = (n, digits) => (typeof n === 'number' && isFinite(n) ? n.toFixed(digits) : '');

  // ---- Numbers typed by the user ----------------------------------------------------------
  const PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

  function parseNumber(text) {
    const t = String(text).trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  }

  // ---- Load an activity ---------------------------------------------------------------------
  function selectNetwork(id) {
    state.network = id;
    state.placing = null;
    state.test = null;
    state.dirty = false;
    $('cal-test').value = '';

    const def = MapService.definition(id);
    state.points = Array.from({ length: MAX_POINTS }, (_, i) => (def && def.points && def.points[i]) ? { ...def.points[i] } : blank());
    state.mode = (def && def.mode) || 'affine';
    $('cal-mode').value = state.mode;

    const map = mapConfig();
    const image = $('cal-image');
    $('cal-map').style.width = '';
    image.onload = () => {
      $('cal-overlay').setAttribute('width', map.width);
      $('cal-overlay').setAttribute('height', map.height);
      $('cal-overlay').setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
      const wrong = image.naturalWidth !== map.width || image.naturalHeight !== map.height;
      $('cal-size-warning').hidden = !wrong;
      if (wrong) {
        $('cal-size-warning').textContent = `Attention : l'image fait ${image.naturalWidth} × ${image.naturalHeight} px mais la configuration indique ${map.width} × ${map.height} px. Corrigez la taille dans config.js avant de calibrer.`;
      }
      draw();
    };
    image.onerror = () => { $('cal-size-warning').hidden = false; $('cal-size-warning').textContent = 'Image de la carte introuvable.'; };
    image.src = MapService.imageUrl(id);

    renderSource(def);
    renderRows();
    refresh();
  }

  function renderSource(def) {
    const el = $('cal-source');
    const method = m => (m === 'perspective' ? '4 points, perspective' : '3 points, carte plate');
    if (def && def.mode) {
      el.textContent = `Calibration enregistrée (${method(def.mode)}).`;
    } else {
      el.textContent = 'Aucune calibration pour cette carte : les positions GPS ne peuvent pas être placées.';
    }
    if (def && def.stale) el.textContent += ' Une calibration enregistrée pour une autre taille d\'image est ignorée.';
  }

  // ---- The point table ------------------------------------------------------------------------
  function renderRows() {
    const box = $('cal-points');
    box.replaceChildren();
    usedPoints().forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'cal-row';
      row.innerHTML = `
        <span class="cal-row__num">${i + 1}</span>
        <div class="form-group"><label class="form-label">Carte : x (px)</label><input type="number" class="form-input" data-field="x" step="1"></div>
        <div class="form-group"><label class="form-label">Carte : y (px)</label><input type="number" class="form-input" data-field="y" step="1"></div>
        <button type="button" class="btn btn-secondary btn-sm cal-row__place">📍 Placer sur la carte</button>
        <div class="form-group"><label class="form-label">Latitude</label><input type="text" inputmode="decimal" class="form-input" data-field="lat" placeholder="45.3116"></div>
        <div class="form-group"><label class="form-label">Longitude</label><input type="text" inputmode="decimal" class="form-input" data-field="lon" placeholder="-72.2408"></div>`;
      row.querySelectorAll('input').forEach(input => {
        input.value = p[input.dataset.field] ?? '';
        input.addEventListener('input', () => onField(i, input, row));
      });
      row.querySelector('.cal-row__place').addEventListener('click', () => {
        state.placing = state.placing === i ? null : i;
        updatePlacing();
        draw();
      });
      box.appendChild(row);
    });
    updatePlacing();
  }

  function onField(index, input, row) {
    const p = state.points[index];
    const field = input.dataset.field;
    if (field === 'lat' || field === 'lon') {
      // "45.3116, -72.2408" pasted into either field fills both
      const pair = PAIR.exec(input.value);
      if (pair) {
        p.lat = Number(pair[1]); p.lon = Number(pair[2]);
        row.querySelector('[data-field="lat"]').value = p.lat;
        row.querySelector('[data-field="lon"]').value = p.lon;
      } else {
        p[field] = parseNumber(input.value);
      }
    } else {
      p[field] = parseNumber(input.value);
    }
    state.dirty = true;
    refresh();
  }

  function updatePlacing() {
    document.querySelectorAll('#cal-points .cal-row').forEach((row, i) => {
      row.classList.toggle('is-placing', state.placing === i);
      row.querySelector('.cal-row__place').textContent = state.placing === i ? '✖ Annuler' : '📍 Placer sur la carte';
    });
    $('cal-map').classList.toggle('is-placing', state.placing !== null);
    $('cal-hint').textContent = state.placing !== null
      ? `Cliquez sur la carte à l'endroit du point ${state.placing + 1}.`
      : 'Cliquez sur la carte pour lire la position GPS de cet endroit.';
  }

  // ---- Compute and draw -----------------------------------------------------------------------
  function refresh() {
    transform = MapService.fit(usedPoints(), state.mode);
    const status = $('cal-status');
    const complete = usedPoints().every(p => [p.x, p.y, p.lat, p.lon].every(v => typeof v === 'number'));
    if (transform.error) {
      status.className = 'cal-status ' + (complete ? 'error' : 'info');
      status.textContent = transform.error;
    } else {
      status.className = 'cal-status ok';
      status.textContent = `Calibration valide (${MapService.MODES[state.mode]} points). Vérifiez la grille et le test ci-dessous, puis enregistrez.`;
    }
    $('cal-save').disabled = !!transform.error;
    $('cal-test-btn').disabled = !!transform.error;
    if (transform.error) $('cal-readout').textContent = '';
    draw();
  }

  function el(name, attrs, text) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const GRID_STEPS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1];

  // Lines of latitude and longitude over the map; each is sampled and cut where it leaves the image
  function drawGrid(svg) {
    const map = mapConfig();
    const corners = [[0, 0], [map.width, 0], [0, map.height], [map.width, map.height]]
      .map(([x, y]) => MapService.unapply(transform, x, y)).filter(Boolean);
    if (corners.length < 4) return;
    const minLat = Math.min(...corners.map(c => c.lat)), maxLat = Math.max(...corners.map(c => c.lat));
    const minLon = Math.min(...corners.map(c => c.lon)), maxLon = Math.max(...corners.map(c => c.lon));
    const span = Math.max(maxLat - minLat, maxLon - minLon);
    const step = GRID_STEPS.find(s => span / s <= 9) || GRID_STEPS[GRID_STEPS.length - 1];
    const inside = p => p && p.x >= -2 && p.y >= -2 && p.x <= map.width + 2 && p.y <= map.height + 2;
    const group = el('g', { fill: 'none', stroke: '#0ea5e9', 'stroke-width': 1.5, opacity: 0.9 });

    const line = (pointAt, label) => {
      let d = '', first = null, pen = false;
      for (let s = 0; s <= 40; s++) {
        const p = pointAt(s / 40);
        if (inside(p)) {
          d += (pen ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
          pen = true;
          if (!first) first = p;
        } else {
          pen = false;
        }
      }
      if (!d) return;
      group.appendChild(el('path', { d }));
      const text = el('text', { x: Math.min(first.x + 4, map.width - 60), y: Math.min(first.y + 13, map.height - 3), fill: '#0369a1', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', 'font-size': 12, 'font-weight': 700 }, label);
      group.appendChild(text);
    };

    for (let lat = Math.ceil((minLat - step) / step) * step; lat <= maxLat + step; lat += step) {
      line(t => MapService.apply(transform, lat, minLon - step + t * (maxLon - minLon + 2 * step)), fmt(lat, 4) + '°');
    }
    for (let lon = Math.ceil((minLon - step) / step) * step; lon <= maxLon + step; lon += step) {
      line(t => MapService.apply(transform, minLat - step + t * (maxLat - minLat + 2 * step), lon), fmt(lon, 4) + '°');
    }
    svg.appendChild(group);
  }

  function drawMarker(svg, x, y, label, color, shape) {
    const g = el('g', { transform: `translate(${x} ${y})` });
    if (shape === 'diamond') {
      g.appendChild(el('path', { d: 'M0 -14 L12 0 L0 14 L-12 0 Z', fill: color, stroke: '#fff', 'stroke-width': 3 }));
    } else {
      g.appendChild(el('circle', { r: 13, fill: color, stroke: '#fff', 'stroke-width': 3 }));
    }
    if (label) g.appendChild(el('text', { y: 5, 'text-anchor': 'middle', fill: '#fff', 'font-size': 14, 'font-weight': 700 }, label));
    svg.appendChild(g);
  }

  function draw() {
    const svg = $('cal-overlay');
    svg.replaceChildren();
    if (!state.network) return;
    if (transform && !transform.error && $('cal-grid').checked) drawGrid(svg);
    usedPoints().forEach((p, i) => {
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        drawMarker(svg, p.x, p.y, String(i + 1), state.placing === i ? '#f59e0b' : '#dc2626');
      }
    });
    if (state.test && transform && !transform.error) {
      const px = MapService.apply(transform, state.test.lat, state.test.lon);
      if (px) drawMarker(svg, px.x, px.y, '', '#16a34a', 'diamond');
    }
  }

  // ---- Interaction ------------------------------------------------------------------------------
  function onMapClick(event) {
    const map = mapConfig();
    const rect = $('cal-map').getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * (map.width / rect.width));
    const y = Math.round((event.clientY - rect.top) * (map.height / rect.height));

    if (state.placing !== null) {
      const p = state.points[state.placing];
      p.x = x; p.y = y;
      const row = document.querySelectorAll('#cal-points .cal-row')[state.placing];
      row.querySelector('[data-field="x"]').value = x;
      row.querySelector('[data-field="y"]').value = y;
      state.placing = null;
      state.dirty = true;
      updatePlacing();
      refresh();
      return;
    }
    if (!transform || transform.error) {
      $('cal-readout').textContent = `Pixel (${x}, ${y}). Complétez les points pour lire la position GPS.`;
      return;
    }
    const gps = MapService.unapply(transform, x, y);
    $('cal-readout').textContent = gps
      ? `Pixel (${x}, ${y}) → GPS ${fmt(gps.lat, 6)}, ${fmt(gps.lon, 6)}`
      : `Pixel (${x}, ${y}) : position GPS impossible à calculer ici.`;
  }

  function onTest() {
    const pair = PAIR.exec($('cal-test').value);
    if (!pair) {
      $('cal-readout').textContent = 'Entrez une position GPS : « 45.3116, -72.2408 ».';
      return;
    }
    state.test = { lat: Number(pair[1]), lon: Number(pair[2]) };
    const map = mapConfig();
    const px = MapService.apply(transform, state.test.lat, state.test.lon);
    if (!px) {
      $('cal-readout').textContent = 'Cette position ne peut pas être placée sur la carte.';
    } else {
      const inMap = px.x >= 0 && px.y >= 0 && px.x <= map.width && px.y <= map.height;
      $('cal-readout').textContent = `GPS ${fmt(state.test.lat, 6)}, ${fmt(state.test.lon, 6)} → pixel (${Math.round(px.x)}, ${Math.round(px.y)})` + (inMap ? ' (losange vert)' : ' : hors de la carte');
      if (inMap) {
        const scroller = $('cal-scroll');
        scroller.scrollTo({ left: Math.max(0, px.x - scroller.clientWidth / 2), top: Math.max(0, px.y - scroller.clientHeight / 2), behavior: 'smooth' });
      }
    }
    draw();
  }

  async function onSave() {
    const button = $('cal-save');
    setButtonLoading(button, true, 'Enregistrement...');
    try {
      await MapService.save(state.network, state.mode, usedPoints(), userId);
      state.dirty = false;
      renderSource(MapService.definition(state.network));
      showMessage(`Calibration de la carte « ${APP_CONFIG.maps[state.network].name} » enregistrée.`, 'success');
    } catch (error) {
      console.error('Error saving the calibration:', error);
      showMessage(`Enregistrement impossible : ${error.message || 'erreur inconnue'}`, 'error');
    } finally {
      setButtonLoading(button, false);
      $('cal-save').disabled = !!(transform && transform.error);
    }
  }

  async function reload() {
    if (state.dirty && !window.confirm('Abandonner les modifications non enregistrées ?')) return;
    await MapService.load(true);
    selectNetwork(state.network);
  }

  // ---- Start ----------------------------------------------------------------------------------------
  function init(uid) {
    userId = uid;
    const ids = Object.keys(APP_CONFIG.maps);
    $('cal-network').innerHTML = ids.map(id => `<option value="${id}">${APP_CONFIG.maps[id].icon} ${APP_CONFIG.maps[id].name}</option>`).join('');

    $('cal-network').addEventListener('change', event => {
      if (state.dirty && !window.confirm('Abandonner les modifications non enregistrées ?')) { event.target.value = state.network; return; }
      selectNetwork(event.target.value);
    });
    $('cal-mode').addEventListener('change', event => {
      state.mode = event.target.value;
      state.placing = null;
      state.dirty = true;
      renderRows();
      refresh();
    });
    $('cal-grid').addEventListener('change', draw);
    $('cal-map').addEventListener('click', onMapClick);
    $('cal-test-btn').addEventListener('click', onTest);
    $('cal-test').addEventListener('keydown', event => { if (event.key === 'Enter' && !transform.error) onTest(); });
    $('cal-save').addEventListener('click', onSave);
    $('cal-reload').addEventListener('click', reload);

    MapService.load().then(() => selectNetwork(ids[0]));
  }

  return { init };
})();
window.MapCalibration = MapCalibration;
