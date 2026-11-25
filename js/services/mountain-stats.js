/**
 * MountainStats - the numbers at the top of the public page: how much of the mountain is open.
 * ============================================================================================
 *   MountainStats.compute(trails)   -> { surface: { open, total, percent }, piste, parc, sousbois, uphill, lift, magic }
 *                                       each of the last six is { open, total }; surface is in acres (open = the surface of the
 *                                       open downhill trails, total = all of them) and percent is null while no surface is entered.
 *   MountainStats.html(stats)       -> the block the public list page draws ('' when the activity has none of these trails)
 *   MountainStats.injectStyles()    -> adds the small stylesheet that block needs (same idea as WeatherPublic)
 *
 * The rules (agreed with the customer, 2026-11):
 *   - a trail counts as OPEN whatever its sub-state: Ouvert, Ouvert damé and Ouverture progressive all count (100 % of the surface);
 *   - downhill trails are counted by type: Pistes, Parc à neige, Sous-bois (trails/{id}.trailType, Piste when not set); the % of
 *     surface open covers all of them (surfaceAcres, 0 when not set);
 *   - uphill trails (Montées) and lifts, by type: Remontées and Tapis magique (liftType, Remontée when not set);
 *   - hidden (archived) trails are not counted.
 * Needs trail-service.js (so config.js and network.js). The point-in-time page of the administration uses the same module.
 */
const MountainStats = (() => {
  'use strict';
  const isOpen = t => TrailService.statusOf(t) === 'open';
  const tally = list => ({ open: list.filter(isOpen).length, total: list.length });
  const acres = list => list.reduce((sum, t) => sum + TrailService.surfaceOf(t), 0);

  /** 0..100, whole number; never 0 while something is open and never 100 while something is still closed */
  function percentOf(open, total) {
    if (!(total > 0)) return null;
    if (open >= total) return 100;
    if (open <= 0) return 0;
    return Math.min(99, Math.max(1, Math.round(open / total * 100)));
  }

  function compute(trails) {
    const list = (trails || []).filter(t => !TrailService.isArchived(t));
    const of = kind => list.filter(t => TrailService.kindOf(t) === kind);
    const down = of('downhill'), lifts = of('lift');
    const type = id => down.filter(t => TrailService.trailTypeOf(t) === id);
    const total = acres(down), open = acres(down.filter(isOpen));
    return {
      surface: { open: Math.round(open * 100) / 100, total: Math.round(total * 100) / 100, percent: percentOf(open, total) },
      piste: tally(type('piste')),
      parc: tally(type('parc')),
      sousbois: tally(type('sousbois')),
      uphill: tally(of('uphill')),
      lift: tally(lifts.filter(t => TrailService.liftTypeOf(t) === 'remontee')),
      magic: tally(lifts.filter(t => TrailService.liftTypeOf(t) === 'tapis'))
    };
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TILES = [['piste', 'Pistes'], ['parc', 'Parc à neige'], ['sousbois', 'Sous-bois'], ['uphill', 'Montées'], ['lift', 'Remontées'], ['magic', 'Tapis magique']];

  /** The block: the % of surface open (only when some surface is entered) and the open / total of each kind. Empty tiles are left out. */
  function html(stats) {
    if (!stats) return '';
    const tiles = TILES.filter(([k]) => stats[k] && stats[k].total > 0);
    const s = stats.surface;
    if (!tiles.length && !(s && s.percent !== null)) return '';
    const surface = s && s.percent !== null
      ? `<div class="mst-surface"><div class="mst-surface__row"><span class="mst-label">Surface skiable ouverte</span><span class="mst-big" data-stat="surface">${s.percent} %</span></div>`
        + `<div class="mst-bar" role="img" aria-label="${s.percent} % de la surface skiable est ouverte"><i style="width:${s.percent}%"></i></div></div>`
      : '';
    return `<div class="mst">${surface}<div class="mst-grid">`
      + tiles.map(([k, label]) => `<div class="mst-tile" data-stat="${k}"><div class="mst-label">${esc(label)}</div><div class="mst-count"><strong>${stats[k].open}</strong><span> / ${stats[k].total}</span></div></div>`).join('')
      + '</div></div>';
  }

  const CSS = `
    .mst { background: var(--theme-surface, #fff); color: var(--theme-text, #1f2937); border: 1px solid var(--theme-border, #e5e7eb); border-radius: 12px; padding: 0.85rem 1rem; margin-bottom: 1rem; }
    .mst-surface { background: var(--theme-surface-alt, #f3f4f6); border-radius: 10px; padding: 0.6rem 0.8rem; margin-bottom: 0.6rem; }
    .mst-surface__row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
    .mst-label { font-size: 0.8rem; color: var(--theme-text-light, #6b7280); }
    .mst-big { font-size: 1.5rem; font-weight: 700; }
    .mst-bar { height: 8px; border-radius: 4px; background: var(--theme-border, #e5e7eb); overflow: hidden; margin-top: 0.4rem; }
    .mst-bar i { display: block; height: 100%; background: #10b981; }
    .mst-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap: 0.6rem; }
    .mst-tile { background: var(--theme-surface-alt, #f3f4f6); border-radius: 10px; padding: 0.5rem 0.7rem; min-width: 0; }
    .mst-count strong { font-size: 1.35rem; font-weight: 700; }
    .mst-count span { font-size: 0.9rem; color: var(--theme-text-light, #6b7280); }`;

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('mst-styles')) return;
    const style = document.createElement('style');
    style.id = 'mst-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  return { compute, html, injectStyles, CSS };
})();
if (typeof window !== 'undefined') window.MountainStats = MountainStats;
