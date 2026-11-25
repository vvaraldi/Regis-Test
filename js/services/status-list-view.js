/**
 * StatusListView - the list of trails and lifts by sector, as the PUBLIC list page draws it.
 * =========================================================================================
 *   StatusListView.html(trails, sectors, options)   the whole list as HTML: the lifts (all the width), the descents by sector, the uphill
 *                                                   trails (all the width) - or, in the bike activity, the trails by sector
 *   StatusListView.injectStyles()                   adds the stylesheet of the list (once)
 *   StatusListView.CSS                              that stylesheet
 *
 * trails: { id, name, number, kind, sector, status, difficulty, openMode, note ... } (what the public file or Firestore holds, or what
 *         MountainAt rebuilt for a date); sectors: { id, name, order, aliases }.
 * options.noteFor(trail) -> text | '': a small line under the name (the page of a past date says "état actuel" where nothing was logged).
 *
 * Used by pages/public-list.html (today) and pages/regis-at.html (any date and time), so that the two look the same.
 * Needs trail-service.js (so config.js and network.js).
 */
const StatusListView = (() => {
  'use strict';
  const STATUS_WORD = { open: 'Ouvert', closed: 'Fermé', unknown: 'Inconnu' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const statusOf = t => TrailService.statusOf(t);

  /** The sector of a trail: its id, or one of the older ids (aliases) it may still carry */
  function sectorOf(trail, sectors) {
    if (!trail.sector) return null;
    return sectors.find(s => s.id === trail.sector) || sectors.find(s => (s.aliases || []).includes(trail.sector)) || null;
  }

  function sortedSectors(sectors) {
    return sectors.slice().sort((a, b) => (a.order == null ? 999 : a.order) - (b.order == null ? 999 : b.order) || String(a.name).localeCompare(String(b.name), 'fr'));
  }

  /** where: the sector's name, shown small after the name in the full-width parts (lifts, uphill) that are not cut by sector */
  function rowHtml(t, where, options) {
    const status = statusOf(t);
    const kind = TrailService.kindOf(t);
    const diff = TrailService.difficultyOf(t) ? TrailService.difficultyLabel(TrailService.difficultyOf(t)) : '';
    // a downhill trail that is open can be "Ouvert damé" or "Ouverture progressive" (green too: it is open); the comment of the manager goes under the name
    const mode = TrailService.openModeOf(t), word = mode ? TrailService.statusWord(t) : STATUS_WORD[status];
    const note = TrailService.noteOf(t);
    const extra = options && options.noteFor ? options.noteFor(t) : '';
    return `<div class="pl-row"><span class="pl-num">${esc(TrailService.markerLabel(t))}</span>`
      + `<span class="pl-name">${esc(t.name || t.id)}${diff && kind !== 'lift' ? `<small>${esc(diff)}</small>` : ''}${where ? `<span class="pl-where">${esc(where)}</span>` : ''}${note ? `<span class="pl-note">${esc(note)}</span>` : ''}${extra ? `<span class="pl-note pl-note--extra">${esc(extra)}</span>` : ''}</span>`
      + `<span class="pl-pill pl-pill--${status}${mode ? ' pl-pill--mode' : ''}">${esc(word)}</span></div>`;
  }

  function sectorBox(name, list, options) {
    const open = list.filter(t => statusOf(t) === 'open').length;
    return `<section class="pl-sector"><div class="pl-sector__head"><h3 class="pl-sector__title">${esc(name)}</h3><span class="pl-sector__count">${open} / ${list.length} ouverts</span></div>`
      + list.slice().sort(TrailService.compare).map(t => rowHtml(t, null, options)).join('')
      + '</section>';
  }

  /** The sector boxes of a list of trails: the sectors in their order, then what has no sector */
  function boxesHtml(list, otherName, sectors, options) {
    const blocks = sortedSectors(sectors).map(s => ({ name: s.name, list: list.filter(t => (sectorOf(t, sectors) || {}).id === s.id) }));
    const loose = list.filter(t => !sectorOf(t, sectors));
    if (loose.length) blocks.push({ name: otherName, list: loose });
    return blocks.filter(b => b.list.length).map(b => sectorBox(b.name, b.list, options)).join('');
  }

  /** A full-width part (lifts, uphill): one card, the rows side by side, ordered by sector then number. When all of them are in ONE
   *  sector, its name goes in the title ("Montées - Randonnée alpine") instead of after every trail; otherwise each row names its sector, small. */
  function widePartHtml(title, list, sectors, options) {
    if (!list.length) return '';
    const order = t => { const s = sectorOf(t, sectors); return s ? sortedSectors(sectors).indexOf(sectors.find(x => x.id === s.id)) : 999; };
    const rows = list.slice().sort((a, b) => order(a) - order(b) || TrailService.compare(a, b));
    const open = list.filter(t => statusOf(t) === 'open').length;
    const names = [...new Set(list.map(t => (sectorOf(t, sectors) || {}).name || ''))];
    const single = names.length === 1 && names[0] ? names[0] : null;
    return `<section class="pl-part" data-part="${esc(title)}"><h2 class="pl-part__title">${esc(single ? title + ' - ' + single : title)} <span class="pl-sector__count">${open} / ${list.length} ouverts</span></h2>`
      + `<div class="pl-wide"><div class="pl-wide__grid">${rows.map(t => rowHtml(t, single ? null : (sectorOf(t, sectors) || {}).name, options)).join('')}</div></div></section>`;
  }

  function html(trails, sectors, options) {
    const list = trails || [], secs = sectors || [];
    const kind = t => TrailService.kindOf(t);
    if (list.some(t => kind(t) === 'bike')) {
      // the bike activity: the trails by sector, nothing else
      return `<section class="pl-part" data-part="Sentiers"><div class="pl-sectors">${boxesHtml(list, secs.length ? 'Autres' : 'Sentiers', secs, options)}</div></section>`;
    }
    const lifts = list.filter(t => kind(t) === 'lift'), uphill = list.filter(t => kind(t) === 'uphill');
    const downhill = list.filter(t => kind(t) !== 'lift' && kind(t) !== 'uphill');
    return widePartHtml('Remontées', lifts, secs, options)
      + (downhill.length ? `<section class="pl-part" data-part="Descentes"><h2 class="pl-part__title">Descentes</h2><div class="pl-sectors">${boxesHtml(downhill, 'Autres', secs, options)}</div></section>` : '')
      + widePartHtml('Montées', uphill, secs, options);
  }

  // From the top: the lifts (all the width), the descents by sector (3 or 4 boxes per line on a wide screen, fewer on a smaller one,
  // one on a phone), then the uphill trails (all the width).
  const CSS = `
    .pl-part__title { margin: 0 0 0.5rem; font-size: 1.2rem; font-weight: 700; }
    .pl-part { margin-bottom: 1.25rem; }
    .pl-sectors { display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: 0.75rem; align-items: start; }
    .pl-sector { margin: 0; background: var(--theme-surface); border: 1px solid var(--theme-border); border-radius: 12px; padding: 0.75rem 1rem 0.5rem; }
    .pl-wide { background: var(--theme-surface); border: 1px solid var(--theme-border); border-radius: 12px; padding: 0.5rem 1rem; }
    .pl-wide__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); column-gap: 1.5rem; }
    .pl-where { color: var(--theme-text-light); font-size: 0.75rem; margin-left: 0.35rem; }
    .pl-sector__head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin: 0 0 0.25rem; }
    .pl-sector__title { margin: 0; font-size: 1.1rem; font-weight: 700; }
    .pl-sector__count { font-size: 0.8rem; color: var(--theme-text-light); white-space: nowrap; }
    .pl-group__title { margin: 0.6rem 0 0.15rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--theme-text-light); }
    .pl-row { display: grid; grid-template-columns: 25px minmax(0, 1fr) auto; align-items: center; gap: 0.5rem; padding: 0.3rem 0; border-bottom: 1px solid var(--theme-border); }
    .pl-row:last-child { border-bottom: none; }
    .pl-num { text-align: right; font-weight: 700; color: var(--theme-text-light); font-size: 0.9rem; }
    .pl-name small { color: var(--theme-text-light); margin-left: 0.35rem; }
    .pl-pill { display: inline-flex; align-items: center; gap: 0.35rem; min-width: 5.2rem; justify-content: center; padding: 0.2rem 0.7rem; border-radius: 999px; font-size: 0.82rem; font-weight: 700; color: #fff; }
    .pl-pill--mode { min-width: 0; max-width: 8.5rem; text-align: center; line-height: 1.15; padding: 0.2rem 0.6rem; }
    .pl-note { display: block; font-size: 0.78rem; font-style: italic; font-weight: 400; color: var(--theme-text-light); margin-top: 0.05rem; overflow-wrap: anywhere; }
    .pl-note--extra { font-style: normal; }
    .pl-pill--open { background: #10b981; }
    .pl-pill--closed { background: #ef4444; }
    .pl-pill--unknown { background: #6b7280; }
    @media (max-width: 760px) {
      .pl-sectors, .pl-wide__grid { grid-template-columns: 1fr; }
    }`;

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('plv-styles')) return;
    const style = document.createElement('style');
    style.id = 'plv-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  return { html, injectStyles, CSS, sectorOf, sortedSectors };
})();
if (typeof window !== 'undefined') window.StatusListView = StatusListView;
