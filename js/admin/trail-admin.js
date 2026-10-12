/**
 * trail-admin.js - Administration > Sentiers and its sectors (system admin only)
 * ===============================================================================
 * Lists, creates and edits the trails of an activity (Firestore trails/{id}): name, number
 * (shown on the map markers), kind (uphill / downhill / lift / bike), sector, difficulty (the
 * scale of that kind), length (optional, information), and the position on the map, pinpointed
 * by clicking on it. The status (open / closed) is set by inspections, not here.
 *
 * Sectors (the areas the infraction and signalisation forms group trails under) are managed
 * here too: the system admin adds, renames and orders sectors, assigns the sector of
 * trails (one by one or several at once). A trail without a sector is highlighted: the forms
 * cannot offer it.
 *
 * Each kind of trail has its own map (APP_CONFIG.trailKinds.<kind>.map): the map shown follows
 * the type filter, or the type of the trail being edited.
 *
 * A trail that is no longer part of the network is hidden (archived: true), never deleted:
 * inspections and reports point to it by id and would lose their history. A hidden trail leaves
 * the map, the pickers and the public page, stays in the history, and can be restored. Its
 * number becomes free again.
 *
 * Needs the markup of the "trails" tab in pages/user-management.html.
 */
const TrailAdmin = (function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  const NO_SECTOR = '__none';

  const state = {
    network: null,
    kindFilter: '',
    sectorFilter: '',  // '' = all, NO_SECTOR = without a sector, else a sector id
    view: 'active',    // 'active' | 'archived' | 'all'
    mapId: null,       // the map currently shown
    trails: [],        // every trail of every activity: { id, ...data }
    sectors: [],       // every sector of every activity (SectorService.loadAll)
    shelters: [],      // every shelter of every activity: { id, ...data }
    selected: new Set(), // trail ids ticked for a bulk sector assignment
    editing: null,     // { id: string|null, trail: object|null } while the editor is open
    placing: false,    // the next click on the map sets the position
    position: null     // { left, top } of the trail being edited
  };
  let userId = null;

  const kindsOfNetwork = () => APP_CONFIG.networks[state.network].trailKinds;
  const inNetwork = () => state.trails.filter(t => Network.of(t) === state.network);
  const networkSectors = () => state.sectors.filter(s => s.network === state.network);
  const sectorOf = trail => (trail && trail.sector ? SectorService.find(networkSectors(), trail.sector) : null);
  const mapConfig = () => APP_CONFIG.maps[state.mapId];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // The map to show: the one of the trail being edited, else of the type filter, else of the first type
  function wantedMapId() {
    const kind = state.editing ? $('tr-kind').value : (state.kindFilter || kindsOfNetwork()[0]);
    return TrailService.mapIdOf(kind);
  }

  // ---- Load ---------------------------------------------------------------------------------------------
  async function load() {
    try {
      const snapshot = await window.db.collection('trails').get();
      state.trails = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error loading trails:', error);
      showMessage('Erreur lors du chargement des sentiers.', 'error');
      state.trails = [];
    }
    try {
      const shelters = await window.db.collection('shelters').get();
      state.shelters = shelters.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error loading shelters:', error);
      state.shelters = [];
    }
    renderAll();
  }

  async function loadSectors(force) {
    try {
      state.sectors = await SectorService.loadAll(force);
    } catch (error) {
      console.error('Error loading sectors:', error);
      showMessage('Erreur lors du chargement des secteurs.', 'error');
      state.sectors = [];
    }
  }

  function renderAll() {
    renderSectorFilters();
    renderList();
    renderOrphanBanner();
    renderSectorPanel();
    renderShelterPanel();
    drawMarkers();
  }

  // ---- The list -------------------------------------------------------------------------------------------
  // Trails without a sector first (highlighted), then by sector order, then by kind, then by number
  function visibleRows() {
    const order = new Map(networkSectors().map((s, i) => [s.id, i + 1]));
    const group = t => { const s = sectorOf(t); return s ? order.get(s.id) : 0; };
    return inNetwork()
      .filter(t => !state.kindFilter || TrailService.kindOf(t) === state.kindFilter)
      .filter(t => state.view === 'all' || (state.view === 'archived') === TrailService.isArchived(t))
      .filter(t => {
        if (!state.sectorFilter) return true;
        const s = sectorOf(t);
        return state.sectorFilter === NO_SECTOR ? !s : !!s && s.id === state.sectorFilter;
      })
      .sort((a, b) => group(a) - group(b) || TrailService.kindOf(a).localeCompare(TrailService.kindOf(b)) || TrailService.compare(a, b));
  }

  function renderSectorFilters() {
    const options = [new Option('Tous les secteurs', ''), new Option('Sans secteur', NO_SECTOR),
      ...networkSectors().map(s => new Option(s.name, s.id))];
    $('trail-sector-filter').replaceChildren(...options);
    $('trail-sector-filter').value = state.sectorFilter;

    const bulk = [new Option('Choisir un secteur…', ''), ...networkSectors().map(s => new Option(s.name, s.id)), new Option('— Retirer le secteur —', NO_SECTOR)];
    $('trail-bulk-sector').replaceChildren(...bulk);
  }

  function renderOrphanBanner() {
    const count = inNetwork().filter(t => !TrailService.isArchived(t) && !sectorOf(t)).length;
    const banner = $('trail-orphan-banner');
    banner.hidden = count === 0;
    if (!count) return;
    $('trail-orphan-text').textContent = `${count} sentier${count > 1 ? 's' : ''} sans secteur : ${count > 1 ? 'ils ne sont pas proposés' : 'il n\'est pas proposé'} dans les formulaires d'infractions et de signalisations.`;
  }

  function renderList() {
    const body = $('trail-rows');
    body.replaceChildren();
    const rows = visibleRows();
    const columns = 10;

    $('trail-count').textContent = `(${rows.length})`;
    updateSelectedCount();
    if (!rows.length) {
      const row = el('tr');
      const cell = el('td', '', state.view === 'archived' ? 'Aucun sentier masqué.' : 'Aucun sentier pour cette sélection.');
      cell.colSpan = columns;
      cell.style.cssText = 'text-align:center; padding: 1.5rem; color: var(--theme-text-secondary);';
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }

    let currentGroup = null;
    rows.forEach(t => {
      const sector = sectorOf(t);
      const groupId = sector ? sector.id : NO_SECTOR;
      if (groupId !== currentGroup) {
        currentGroup = groupId;
        const count = rows.filter(r => (sectorOf(r) ? sectorOf(r).id : NO_SECTOR) === groupId).length;
        const heading = el('tr', 'trail-group' + (sector ? '' : ' is-orphan'));
        const cell = el('td', '', sector ? `${sector.name} (${count})` : `⚠ Sans secteur (${count})`);
        cell.colSpan = columns;
        heading.appendChild(cell);
        body.appendChild(heading);
      }

      const archived = TrailService.isArchived(t);
      const row = el('tr', 'trail-row' + (archived ? ' is-archived' : '') + (sector ? '' : ' is-orphan') + (state.editing && state.editing.id === t.id ? ' is-selected' : ''));
      const box = el('td');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = state.selected.has(t.id);
      check.setAttribute('aria-label', `Cocher ${t.name || t.id}`);
      check.addEventListener('change', () => { check.checked ? state.selected.add(t.id) : state.selected.delete(t.id); updateSelectedCount(); });
      box.appendChild(check);
      row.appendChild(box);

      // The number can be typed straight in the list
      const numberCell = el('td');
      const numberInput = document.createElement('input');
      numberInput.type = 'text';
      numberInput.className = 'form-input trail-number-input';
      numberInput.maxLength = 6;
      numberInput.value = t.number != null ? t.number : '';
      numberInput.disabled = archived;
      numberInput.setAttribute('aria-label', `Numéro de ${t.name || t.id}`);
      numberInput.addEventListener('change', () => saveNumber(t, numberInput));
      numberCell.appendChild(numberInput);
      row.appendChild(numberCell);

      const hasPosition = t.coordinates && t.coordinates.left != null && t.coordinates.top != null;
      [
        (t.name || t.id) + (archived ? ' (masqué)' : ''),
        sector ? sector.name : (t.sector ? `${t.sector} (inconnu)` : 'Sans secteur'),
        TrailService.kindLabel(TrailService.kindOf(t)),
        TrailService.difficultyLabel(TrailService.difficultyOf(t), true) || '-',
        t.length != null && t.length !== '' ? `${t.length} km` : '-',
        TrailService.statusText(TrailService.statusOf(t), true),
        hasPosition ? '✓' : '-'
      ].forEach(text => row.appendChild(el('td', '', text)));
      const action = el('td');
      const button = el('button', 'btn btn-secondary btn-sm', 'Modifier');
      button.type = 'button';
      button.addEventListener('click', () => startEdit(t));
      action.appendChild(button);
      row.appendChild(action);
      row.addEventListener('dblclick', event => { if (event.target.tagName !== 'INPUT') startEdit(t); });
      body.appendChild(row);
    });
  }

  function updateSelectedCount() {
    $('trail-selected-count').textContent = state.selected.size ? `${state.selected.size} coché(s)` : '';
  }

  // Number typed in the list: same rule as in the editor (not twice for the same kind of visible trail)
  async function saveNumber(trail, input) {
    const number = input.value.trim();
    const previous = trail.number != null ? String(trail.number) : '';
    if (number === previous) return;
    const clash = numberTaken(number, TrailService.kindOf(trail), trail.id);
    if (clash) {
      showMessage(`Le numéro ${number} est déjà utilisé par « ${clash.name} ».`, 'warning');
      input.value = previous;
      return;
    }
    try {
      await window.db.collection('trails').doc(trail.id).update({
        number: number === '' ? firebase.firestore.FieldValue.delete() : number,
        modifiedAt: firebase.firestore.FieldValue.serverTimestamp(), modifiedBy: userId
      });
      trail.number = number === '' ? undefined : number;
      drawMarkers();
    } catch (error) {
      console.error('Error saving the number:', error);
      showMessage(`Numéro non enregistré : ${error.message || 'erreur inconnue'}`, 'error');
      input.value = previous;
    }
  }

  // ---- Bulk sector assignment (system admin) --------------------------------------------------------------
  async function bulkAssign() {
    const target = $('trail-bulk-sector').value;
    if (!target) { showMessage('Choisissez le secteur à attribuer.', 'warning'); return; }
    const ids = [...state.selected].filter(id => state.trails.some(t => t.id === id));
    if (!ids.length) { showMessage('Cochez au moins un sentier.', 'warning'); return; }
    const sectorName = target === NO_SECTOR ? null : (networkSectors().find(s => s.id === target) || {}).name;
    if (!window.confirm(target === NO_SECTOR ? `Retirer le secteur de ${ids.length} sentier(s) ?` : `Attribuer le secteur « ${sectorName} » à ${ids.length} sentier(s) ?`)) return;

    const button = $('trail-bulk-apply');
    setButtonLoading(button, true, 'Enregistrement...');
    try {
      const value = target === NO_SECTOR ? firebase.firestore.FieldValue.delete() : target;
      const stamp = firebase.firestore.FieldValue.serverTimestamp();
      for (let i = 0; i < ids.length; i += 400) {
        const batch = window.db.batch();
        ids.slice(i, i + 400).forEach(id => batch.update(window.db.collection('trails').doc(id), { sector: value, modifiedAt: stamp, modifiedBy: userId }));
        await batch.commit();
      }
      state.selected.clear();
      showMessage(`${ids.length} sentier(s) mis à jour.`, 'success');
      await load();
    } catch (error) {
      console.error('Error assigning the sector:', error);
      showMessage(`Attribution impossible : ${error.message || 'erreur inconnue'}`, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function toggleSelectAll(checked) {
    visibleRows().forEach(t => (checked ? state.selected.add(t.id) : state.selected.delete(t.id)));
    renderList();
  }

  // ---- The map ----------------------------------------------------------------------------------------------
  // Shows the wanted map; loads the image only when the map changes
  function refreshMap() {
    const wanted = wantedMapId();
    if (wanted === state.mapId) { drawMarkers(); return; }
    state.mapId = wanted;
    const config = mapConfig();
    $('trail-map-title').textContent = `Carte : ${config.name}`;
    const image = $('trail-image');
    image.onload = () => {
      const overlay = $('trail-overlay');
      overlay.setAttribute('width', config.width);
      overlay.setAttribute('height', config.height);
      overlay.setAttribute('viewBox', `0 0 ${config.width} ${config.height}`);
      const wrong = image.naturalWidth !== config.width || image.naturalHeight !== config.height;
      $('trail-size-warning').hidden = !wrong;
      if (wrong) {
        $('trail-size-warning').textContent = `Attention : l'image fait ${image.naturalWidth} × ${image.naturalHeight} px mais la configuration indique ${config.width} × ${config.height} px. Les positions sont des pixels de l'image.`;
      }
      drawMarkers();
    };
    image.onerror = () => { $('trail-size-warning').hidden = false; $('trail-size-warning').textContent = 'Image de la carte introuvable.'; };
    $('trail-size-warning').hidden = true;
    image.src = MapService.imageUrl(state.mapId);
    drawMarkers();
  }

  function marker(svg, position, label, className, onClick) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${position.left} ${position.top})`);
    g.setAttribute('class', className);
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', 12);
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('y', 4);
    text.setAttribute('text-anchor', 'middle');
    text.textContent = label;
    g.append(circle, text);
    if (onClick) g.addEventListener('click', onClick);
    svg.appendChild(g);
  }

  function drawMarkers() {
    const svg = $('trail-overlay');
    svg.replaceChildren();
    if (!state.network || !state.mapId) return;
    const editingId = state.editing && state.editing.id;

    // The trails placed on this map (hidden ones are not drawn)
    inNetwork().forEach(t => {
      const c = t.coordinates;
      if (!c || c.left == null || c.top == null || t.id === editingId) return;
      if (TrailService.isArchived(t) || TrailService.mapIdOf(t) !== state.mapId) return;
      marker(svg, c, TrailService.markerLabel(t), 'trail-marker', event => {
        if (state.placing) return;           // placing: the click goes to the map
        event.stopPropagation();
        startEdit(t);
      });
    });
    // The trail being edited: at its (possibly not yet saved) position
    if (state.editing && state.position) {
      const number = $('tr-number').value.trim();
      marker(svg, state.position, number || TrailService.markerLabel({ id: editingId || '', number: null }) || '•', 'trail-marker trail-marker--current');
    }
  }

  function onMapClick(event) {
    if (!state.placing) return;
    const config = mapConfig();
    const rect = $('trail-map').getBoundingClientRect();
    state.position = {
      left: Math.round((event.clientX - rect.left) * (config.width / rect.width)),
      top: Math.round((event.clientY - rect.top) * (config.height / rect.height))
    };
    state.placing = false;
    syncPosition();
    updatePlacing();
    drawMarkers();
  }

  function updatePlacing() {
    $('trail-map').classList.toggle('is-placing', state.placing);
    $('tr-place').textContent = state.placing ? '✖ Annuler' : '📍 Placer sur la carte';
    $('trail-hint').textContent = state.placing
      ? 'Cliquez sur la carte à l\'endroit du sentier.'
      : (state.editing ? 'Cliquez sur « Placer sur la carte » pour positionner ou déplacer ce sentier.' : 'La carte suit le type choisi. Cliquez sur un repère pour modifier ce sentier.');
  }

  function syncPosition() {
    $('tr-x').value = state.position ? state.position.left : '';
    $('tr-y').value = state.position ? state.position.top : '';
  }

  // ---- The editor ---------------------------------------------------------------------------------------------
  function fillDifficulty(kind, selected) {
    const scale = TrailService.scaleOf(kind);
    $('tr-difficulty-group').hidden = scale.length === 0; // lifts have no difficulty
    const select = $('tr-difficulty');
    select.replaceChildren(new Option('Non précisée', ''));
    scale.forEach(id => select.appendChild(new Option(TrailService.difficultyLabel(id, true), id)));
    select.value = scale.includes(selected) ? selected : '';
  }

  function fillSectorSelect(trail) {
    const select = $('tr-sector');
    select.replaceChildren(new Option('Sans secteur', ''), ...networkSectors().map(s => new Option(s.name, s.id)));
    const sector = sectorOf(trail);
    if (sector) {
      select.value = sector.id;
    } else if (trail && trail.sector) {
      select.appendChild(new Option(`${trail.sector} (secteur inconnu)`, trail.sector));
      select.value = trail.sector;
    } else {
      select.value = '';
    }
  }

  function statusLine(trail) {
    if (!trail) return 'Le statut sera défini par la première inspection.';
    if (TrailService.isArchived(trail)) {
      const when = trail.archivedAt && trail.archivedAt.toDate ? ` depuis le ${trail.archivedAt.toDate().toLocaleDateString('fr-CA')}` : '';
      return `Sentier masqué${when} : absent de la carte, des listes et de la page publique. L'historique est conservé.`;
    }
    return `Statut actuel : ${TrailService.statusText(TrailService.statusOf(trail), true)} (modifié par les inspections)`;
  }

  function startEdit(trail) {
    state.placing = false;
    const kind = trail ? TrailService.kindOf(trail) : (state.kindFilter || kindsOfNetwork()[0]);
    state.editing = { id: trail ? trail.id : null, trail: trail || null };
    state.position = trail && trail.coordinates && trail.coordinates.left != null && trail.coordinates.top != null
      ? { left: trail.coordinates.left, top: trail.coordinates.top } : null;

    $('trail-editor').hidden = false;
    $('trail-editor-title').textContent = trail ? `Modifier « ${trail.name || trail.id} »` : 'Nouveau sentier';
    $('tr-name').value = trail ? (trail.name || '') : '';
    $('tr-number').value = trail && trail.number != null ? trail.number : '';
    $('tr-kind').replaceChildren(...kindsOfNetwork().map(k => new Option(TrailService.kindLabel(k), k)));
    $('tr-kind').value = kind;
    fillDifficulty(kind, trail ? TrailService.difficultyOf(trail) : '');
    fillSectorSelect(trail);
    if (!trail && state.sectorFilter && state.sectorFilter !== NO_SECTOR) $('tr-sector').value = state.sectorFilter;
    $('tr-length').value = trail && trail.length != null ? trail.length : '';
    $('tr-status').textContent = statusLine(trail);
    // Hide / restore only exist for a saved trail
    const archived = TrailService.isArchived(trail);
    $('tr-archive').hidden = !trail || archived;
    $('tr-restore').hidden = !trail || !archived;
    $('tr-save-next').hidden = archived;
    syncPosition();
    updatePlacing();
    renderList();
    refreshMap();
    $('trail-editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('tr-name').focus();

    if (state.position) {
      const scroller = $('trail-scroll');
      scroller.scrollTo({ left: Math.max(0, state.position.left - scroller.clientWidth / 2), top: Math.max(0, state.position.top - scroller.clientHeight / 2), behavior: 'smooth' });
    }
  }

  function closeEditor() {
    state.editing = null;
    state.placing = false;
    state.position = null;
    $('trail-editor').hidden = true;
    updatePlacing();
    renderList();
    refreshMap();
  }

  // A position is a spot on ONE map: moving a trail to a kind on another map clears it
  function onKindChange(kind) {
    const previousMap = state.mapId;
    fillDifficulty(kind, $('tr-difficulty').value);
    state.placing = false;
    refreshMap();
    if (state.mapId !== previousMap && state.position) {
      state.position = null;
      syncPosition();
      drawMarkers();
      showMessage(`Ce type utilise une autre carte (${mapConfig().name}) : replacez le sentier sur cette carte.`, 'info');
    }
    updatePlacing();
  }

  function parseLength(text) {
    const t = text.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return isFinite(n) && n >= 0 ? n : NaN;
  }

  // A number identifies a trail on the map: not twice for the same kind of (visible) trail
  function numberTaken(number, kind, exceptId) {
    return inNetwork().find(t => t.id !== exceptId && !TrailService.isArchived(t) &&
      number !== '' && t.number != null && String(t.number) === number && TrailService.kindOf(t) === kind);
  }

  /** Saves the editor. next = true: then open the next trail of the list. */
  async function save(next) {
    if (!state.editing) return;
    const name = $('tr-name').value.trim();
    const number = $('tr-number').value.trim();
    const kind = $('tr-kind').value;
    const hasDifficulty = TrailService.scaleOf(kind).length > 0;
    const difficulty = hasDifficulty ? $('tr-difficulty').value : '';
    const length = parseLength($('tr-length').value);
    const sector = $('tr-sector').value;
    const editingId = state.editing.id;
    const archived = TrailService.isArchived(state.editing.trail);

    if (!name) { showMessage('Le nom du sentier est requis.', 'warning'); return; }
    if (Number.isNaN(length)) { showMessage('La longueur doit être un nombre de km (ou vide).', 'warning'); return; }
    const duplicate = !archived && numberTaken(number, kind, editingId);
    if (duplicate) { showMessage(`Le numéro ${number} est déjà utilisé par « ${duplicate.name} ».`, 'warning'); return; }

    const button = next ? $('tr-save-next') : $('tr-save');
    setButtonLoading(button, true, 'Enregistrement...');
    try {
      const del = firebase.firestore.FieldValue.delete();
      const stamp = firebase.firestore.FieldValue.serverTimestamp();
      let savedId = editingId;
      if (editingId) {
        // Cleared fields are removed; kind and difficulty are written in the current vocabulary
        const update = {
          name, kind, network: state.network,
          number: number === '' ? del : number,
          difficulty: difficulty === '' ? del : difficulty,
          length: length === null ? del : length,
          coordinates: state.position ? { left: state.position.left, top: state.position.top } : del,
          modifiedAt: stamp, modifiedBy: userId
        };
        update.sector = sector === '' ? del : sector;
        await window.db.collection('trails').doc(editingId).update(update);
      } else {
        savedId = TrailService.nextId(kind, state.trails.map(t => t.id));
        const data = { name, kind, network: state.network, createdAt: stamp, createdBy: userId };
        if (number !== '') data.number = number;
        if (difficulty !== '') data.difficulty = difficulty;
        if (length !== null) data.length = length;
        if (sector !== '') data.sector = sector;
        if (state.position) data.coordinates = { left: state.position.left, top: state.position.top };
        await window.db.collection('trails').doc(savedId).set(data);
      }
      showMessage(`Sentier « ${name} » enregistré.`, 'success');
      closeEditor();
      await load();
      if (next) openNext(savedId);
    } catch (error) {
      console.error('Error saving the trail:', error);
      showMessage(`Enregistrement impossible : ${error.message || 'erreur inconnue'}`, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  // After a save: the next trail of the displayed list (with or without a position). A trail without
  // a position is opened ready to be placed: the next click on the map sets it.
  function openNext(afterId) {
    const rows = visibleRows();
    const index = rows.findIndex(t => t.id === afterId);
    const next = index >= 0 ? rows[index + 1] : null;
    if (!next) { showMessage('C\'était le dernier sentier de la liste.', 'info'); return; }
    startEdit(next);
    state.placing = !(next.coordinates && next.coordinates.left != null);
    updatePlacing();
  }

  // ---- Hide / restore ---------------------------------------------------------------------------------------------
  async function archive() {
    const trail = state.editing && state.editing.trail;
    if (!trail) return;
    const message = `Masquer « ${trail.name || trail.id} » ?\n\nIl disparaîtra de la carte, des listes et de la page publique. ` +
      `Son historique (inspections, rapports) est conservé, et vous pourrez le restaurer.`;
    if (!window.confirm(message)) return;
    try {
      await window.db.collection('trails').doc(trail.id).update({
        archived: true,
        archivedAt: firebase.firestore.FieldValue.serverTimestamp(),
        archivedBy: userId
      });
      showMessage(`Sentier « ${trail.name || trail.id} » masqué.`, 'success');
      closeEditor();
      await load();
    } catch (error) {
      console.error('Error hiding the trail:', error);
      showMessage(`Impossible de masquer le sentier : ${error.message || 'erreur inconnue'}`, 'error');
    }
  }

  async function restore() {
    const trail = state.editing && state.editing.trail;
    if (!trail) return;
    const number = trail.number != null ? String(trail.number) : '';
    const clash = numberTaken(number, TrailService.kindOf(trail), trail.id);
    if (clash) {
      showMessage(`Le numéro ${number} est maintenant utilisé par « ${clash.name} » : changez d'abord le numéro de ce sentier (enregistrez), puis restaurez-le.`, 'warning');
      return;
    }
    try {
      const del = firebase.firestore.FieldValue.delete();
      await window.db.collection('trails').doc(trail.id).update({ archived: del, archivedAt: del, archivedBy: del });
      showMessage(`Sentier « ${trail.name || trail.id} » restauré.`, 'success');
      closeEditor();
      await load();
    } catch (error) {
      console.error('Error restoring the trail:', error);
      showMessage(`Impossible de restaurer le sentier : ${error.message || 'erreur inconnue'}`, 'error');
    }
  }

  // ---- Shelters: hide / restore (never deleted: inspections point to them by id) ------------------------------------
  function renderShelterPanel() {
    const panel = $('shelter-panel');
    if (!panel) return;
    const config = APP_CONFIG.networks[state.network];
    panel.hidden = !(config && config.features && config.features.shelters);
    const body = $('shelter-rows');
    body.replaceChildren();
    state.shelters
      .filter(s => Network.of(s) === state.network)
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'fr'))
      .forEach(shelter => {
        const hidden = TrailService.isArchived(shelter);
        const row = el('tr', hidden ? 'is-archived' : '');
        row.dataset.id = shelter.id;
        const action = el('td');
        const button = el('button', 'btn btn-secondary btn-sm', hidden ? 'Restaurer' : 'Masquer');
        button.type = 'button';
        button.addEventListener('click', () => setShelterHidden(shelter, !hidden, button));
        action.appendChild(button);
        row.append(el('td', '', shelter.name || shelter.id), el('td', '', hidden ? 'Masqué' : 'Visible'), action);
        body.appendChild(row);
      });
  }

  async function setShelterHidden(shelter, hide, button) {
    const name = shelter.name || shelter.id;
    if (hide && !window.confirm(`Masquer l'abri « ${name} » ?\n\nIl disparaîtra de la carte et du formulaire de rapport d'abri. Son historique d'inspections est conservé, et vous pourrez le restaurer.`)) return;
    setButtonLoading(button, true, '...');
    try {
      const del = firebase.firestore.FieldValue.delete();
      await window.db.collection('shelters').doc(shelter.id).update(hide
        ? { archived: true, archivedAt: firebase.firestore.FieldValue.serverTimestamp(), archivedBy: userId }
        : { archived: del, archivedAt: del, archivedBy: del });
      showMessage(`Abri « ${name} » ${hide ? 'masqué' : 'restauré'}.`, 'success');
      await load();
    } catch (error) {
      console.error('Error hiding the shelter:', error);
      showMessage(`Impossible de modifier l'abri : ${error.message || 'erreur inconnue'}`, 'error');
      setButtonLoading(button, false);
    }
  }

  // ---- Sectors (system admin) --------------------------------------------------------------------------------------
  function slugify(text) {
    return SectorService.norm(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function renderSectorPanel() {
    const body = $('sector-rows');
    if (!body) return;
    body.replaceChildren();
    networkSectors().forEach(sector => {
      const count = inNetwork().filter(t => !TrailService.isArchived(t) && sectorOf(t) && sectorOf(t).id === sector.id).length;
      const row = el('tr');

      const orderCell = el('td');
      const order = document.createElement('input');
      order.type = 'number'; order.className = 'form-input'; order.style.width = '5rem';
      order.value = sector.order != null ? sector.order : '';
      order.setAttribute('aria-label', `Ordre de ${sector.name}`);
      orderCell.appendChild(order);

      const nameCell = el('td');
      const name = document.createElement('input');
      name.type = 'text'; name.className = 'form-input'; name.value = sector.name || ''; name.maxLength = 60;
      name.setAttribute('aria-label', 'Nom du secteur');
      nameCell.appendChild(name);

      const aliases = sector.aliases.length ? `anciens identifiants : ${sector.aliases.join(', ')}` : '';
      const info = el('td', '', `${count} sentier(s)${aliases ? ' · ' + aliases : ''}`);
      info.style.cssText = 'font-size: 0.8125rem; color: var(--theme-text-secondary);';

      const actionCell = el('td');
      const button = el('button', 'btn btn-secondary btn-sm', 'Enregistrer');
      button.type = 'button';
      button.addEventListener('click', () => saveSector(sector, name, order, button));
      actionCell.appendChild(button);

      row.append(orderCell, nameCell, info, actionCell);
      body.appendChild(row);
    });
  }

  async function saveSector(sector, nameInput, orderInput, button) {
    const name = nameInput.value.trim();
    if (!name) { showMessage('Le nom du secteur est requis.', 'warning'); return; }
    const order = orderInput.value === '' ? null : Number(orderInput.value);
    setButtonLoading(button, true, '...');
    try {
      await window.db.collection('sectors').doc(sector.id).update({
        name, order,
        modifiedAt: firebase.firestore.FieldValue.serverTimestamp(), modifiedBy: userId
      });
      showMessage(`Secteur « ${name} » enregistré.`, 'success');
      await loadSectors(true);
      renderAll();
    } catch (error) {
      console.error('Error saving the sector:', error);
      showMessage(`Secteur non enregistré : ${error.message || 'erreur inconnue'}`, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function addSector() {
    const name = $('sector-new-name').value.trim();
    if (!name) { showMessage('Le nom du secteur est requis.', 'warning'); return; }
    // The id is a readable slug of the name, made unique (ids and aliases are global)
    const taken = new Set(state.sectors.flatMap(s => [s.id, ...s.aliases]));
    const base = slugify(name) || 'secteur';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    const order = Math.max(0, ...networkSectors().map(s => s.order || 0)) + 1;
    try {
      await window.db.collection('sectors').doc(id).set({
        name, network: state.network, order, trails: [], aliases: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: userId
      });
      $('sector-new-name').value = '';
      showMessage(`Secteur « ${name} » ajouté.`, 'success');
      await loadSectors(true);
      renderAll();
    } catch (error) {
      console.error('Error adding the sector:', error);
      showMessage(`Secteur non ajouté : ${error.message || 'erreur inconnue'}`, 'error');
    }
  }

  // ---- Start ------------------------------------------------------------------------------------------------------------
  function selectNetwork(id) {
    state.network = id;
    state.kindFilter = '';
    state.sectorFilter = '';
    state.mapId = null;
    state.selected.clear();
    closeEditor();
    const kinds = kindsOfNetwork();
    $('trail-kind-filter').replaceChildren(new Option('Tous les types', ''), ...kinds.map(k => new Option(TrailService.kindLabel(k), k)));
    $('trail-kind-filter').parentElement.hidden = kinds.length < 2; // no filter needed with a single kind
    renderAll();
    refreshMap();
  }

  /**
   * @param networkIds the activities offered (the system admin's)
   */
  async function init(uid, networkIds) {
    userId = uid;

    $('trail-network').innerHTML = networkIds.map(id => `<option value="${id}">${APP_CONFIG.networks[id].icon} ${APP_CONFIG.networks[id].name}</option>`).join('');
    $('trail-network').addEventListener('change', event => selectNetwork(event.target.value));
    $('trail-kind-filter').addEventListener('change', event => { state.kindFilter = event.target.value; renderList(); refreshMap(); });
    $('trail-sector-filter').addEventListener('change', event => { state.sectorFilter = event.target.value; renderList(); });
    $('trail-view').addEventListener('change', event => { state.view = event.target.value; renderList(); });
    $('trail-orphan-show').addEventListener('click', () => { state.sectorFilter = NO_SECTOR; state.view = 'active'; $('trail-view').value = 'active'; $('trail-sector-filter').value = NO_SECTOR; renderList(); });
    $('trail-new').addEventListener('click', () => startEdit(null));
    $('tr-kind').addEventListener('change', event => onKindChange(event.target.value));
    $('tr-number').addEventListener('input', drawMarkers);
    $('tr-place').addEventListener('click', () => { state.placing = !state.placing; updatePlacing(); });
    $('tr-clear').addEventListener('click', () => { state.position = null; state.placing = false; syncPosition(); updatePlacing(); drawMarkers(); });
    $('tr-cancel').addEventListener('click', closeEditor);
    $('tr-save').addEventListener('click', () => save(false));
    $('tr-save-next').addEventListener('click', () => save(true));
    $('tr-archive').addEventListener('click', archive);
    $('tr-restore').addEventListener('click', restore);
    $('trail-map').addEventListener('click', onMapClick);
    $('trail-select-all').addEventListener('change', event => toggleSelectAll(event.target.checked));
    $('trail-bulk-apply').addEventListener('click', bulkAssign);
    $('sector-new-add').addEventListener('click', addSector);

    await loadSectors();
    // Start on the activity chosen in the portal when this admin manages it, else their first one
    const portalNetwork = (window.Network && Network.current && Network.current()) || null;
    const first = networkIds.includes(portalNetwork) ? portalNetwork : networkIds[0];
    $('trail-network').value = first;
    selectNetwork(first);
    load();
  }

  return { init };
})();
window.TrailAdmin = TrailAdmin;
