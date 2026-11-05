/**
 * occasions.js - Occasion themes (Noël, Nouvel An, Pâques...)
 * ===========================================================
 * On the days of an occasion the working pages get festive header colours and a greeting
 * banner under the header (closable, for the day). The portal also gets falling snow
 * (Noël) or confetti (Nouvel An). The public pages never load this file: layout.js (the
 * shared header of the working pages) loads it, public-status / public-list do not use layout.js.
 *
 * The list below is the ONLY place to change dates, colours and texts.
 *   from / to    [month, day], both included, every year. from after to (31 déc -> 1 jan) wraps the year.
 *   easter       { before, after }: days around Easter Sunday (2 = Good Friday, 1 = Easter Monday)
 *   colors       [header from, header to, banner background] - white text sits on all three
 *   effect       'snow' | 'confetti' | 'icons' | null - what falls on the portal (icons: the characters of `fall`)
 *
 * Preview before the day (stays for the browser tab): add ?occasion=noel to any page address,
 * ?occasion=off to switch it off again. The ids are the ones below.
 * Or pretend it is another day: ?fakedate=2026-12-25 (then ?fakedate=off, or ?occasion=off for both).
 * Pages of the tab then behave as on that day (nothing for an ordinary day); the banner says "(aperçu)".
 *
 * Status colours (green open / red closed) are never touched. Nothing moves for people who
 * asked their device for less motion.
 */
const Occasions = (function () {
  'use strict';

  const LIST = [
    { id: 'noel',          name: 'Noël',                      from: [12, 24], to: [12, 26], colors: ['#b3202a', '#8c1720', '#1f6b3a'], icons: ['🎄', '🎁'], effect: 'snow',
      text: 'Joyeux Noël de la part de toute l’équipe d’Orford' },
    { id: 'nouvel-an',     name: 'Nouvel An',                 from: [12, 31], to: [1, 1],   colors: ['#1c2a5c', '#10193d', '#8a6d12'], icons: ['🎆', '🥂'], effect: 'confetti',
      text: 'Bonne année ! Tous nos vœux à toute l’équipe' },
    { id: 'saint-valentin', name: 'Saint-Valentin',           from: [2, 14],  to: [2, 14],  colors: ['#c2185b', '#8e1043', '#7a0f38'], icons: ['💝', '💝'], effect: 'icons', fall: ['💗', '💝', '❤️'],
      text: 'Bonne Saint-Valentin à toute l’équipe' },
    { id: 'paques',        name: 'Pâques',                    easter: { before: 2, after: 1 }, colors: ['#8e5fb5', '#6f4594', '#4f8a5b'], icons: ['🐣', '🌷'], effect: 'icons', fall: ['🥚', '🐣', '🌷'],
      text: 'Joyeuses Pâques à toute l’équipe' },
    { id: 'fete-nationale', name: 'Fête nationale du Québec', from: [6, 24],  to: [6, 24],  colors: ['#0a4a99', '#073670', '#073670'], icons: ['⚜️', '⚜️'], effect: 'icons', fall: ['⚜️'],
      text: 'Bonne Fête nationale à toute l’équipe' },
    { id: 'fete-canada',   name: 'Fête du Canada',            from: [7, 1],   to: [7, 1],   colors: ['#d52b1e', '#a81d13', '#a81d13'], icons: ['🍁', '🍁'], effect: 'icons', fall: ['🍁'],
      text: 'Bonne Fête du Canada à toute l’équipe' },
    { id: 'halloween',     name: 'Halloween',                 from: [10, 31], to: [10, 31], colors: ['#d9650f', '#a84c08', '#2b2230'], icons: ['🎃', '👻'], effect: 'icons', fall: ['🎃', '🦇', '👻'],
      text: 'Joyeux Halloween à toute l’équipe' }
  ];

  const PREVIEW_KEY = 'orford-occasion-preview';
  const CLOSED_KEY = 'orford-occasion-closed';
  const FAKE_KEY = 'orford-occasion-fakedate';

  // Easter Sunday of a year (Gregorian calendar, "Meeus/Jones/Butcher")
  function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  const key = d => d.getMonth() * 100 + 100 + d.getDate();   // month 1-12 * 100 + day

  function matches(o, date) {
    if (o.easter) {
      const sunday = easter(date.getFullYear());
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const days = Math.round((day - sunday) / 86400000);
      return days >= -o.easter.before && days <= o.easter.after;
    }
    const k = key(date), from = o.from[0] * 100 + o.from[1], to = o.to[0] * 100 + o.to[1];
    return from <= to ? (k >= from && k <= to) : (k >= from || k <= to);
  }

  /** The occasion of a date (the first of the list), or null. */
  function forDate(date) {
    return LIST.find(o => matches(o, date)) || null;
  }

  function byId(id) {
    return LIST.find(o => o.id === id) || null;
  }

  function store(fn) { try { return fn(); } catch (e) { return null; } }

  /** A simulated date from ?fakedate=2026-12-25 (kept for the tab), or null. */
  function fakeDate(search) {
    const param = new URLSearchParams(search || '').get('fakedate');
    if (param === 'off') store(() => sessionStorage.removeItem(FAKE_KEY));
    else if (/^\d{4}-\d{2}-\d{2}$/.test(param || '')) store(() => sessionStorage.setItem(FAKE_KEY, param));
    const saved = store(() => sessionStorage.getItem(FAKE_KEY));
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(saved || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
    return d.getMonth() === +m[2] - 1 ? d : null;   // 2026-02-31 is not a date
  }

  /** What to show now: a preview from ?occasion= or a simulated date from ?fakedate= (both kept for
   *  the tab), else the real date. A preview is marked "(aperçu)" and closing it is not remembered. */
  function current(now, search) {
    const param = new URLSearchParams(search || '').get('occasion');
    if (param === 'off') { store(() => sessionStorage.removeItem(PREVIEW_KEY)); store(() => sessionStorage.removeItem(FAKE_KEY)); }
    else if (param && byId(param)) store(() => sessionStorage.setItem(PREVIEW_KEY, param));
    const fake = param === 'off' ? null : fakeDate(search);
    const preview = store(() => sessionStorage.getItem(PREVIEW_KEY));
    if (preview && byId(preview)) return { occasion: byId(preview), preview: true };
    if (param === 'off') return { occasion: null, preview: false };
    if (fake) return { occasion: forDate(fake), preview: true, fake };
    const o = forDate(now);
    return { occasion: o, preview: false };
  }

  const closedToday = (o, now) => store(() => localStorage.getItem(CLOSED_KEY)) === `${o.id}:${now.getFullYear()}-${key(now)}`;

  function removeFx() {
    const fx = document.querySelector('.occasion-fx');
    if (fx) fx.remove();
  }

  function startFx(o) {
    if (!o.effect) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div');
    box.className = 'occasion-fx';
    box.setAttribute('aria-hidden', 'true');
    const small = window.innerWidth < 700;
    const n = small ? 16 : 34;
    const confetti = ['#f4c430', '#e8618c', '#4aa3df', '#6cc070', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'occasion-fx__piece occasion-fx__piece--' + o.effect;
      const size = o.effect === 'snow' ? 10 + Math.random() * 14 : o.effect === 'icons' ? 16 + Math.random() * 12 : 6 + Math.random() * 6;
      s.style.left = (Math.random() * 100).toFixed(1) + '%';
      s.style.fontSize = size.toFixed(0) + 'px';
      s.style.animationDuration = (9 + Math.random() * 9).toFixed(1) + 's';
      s.style.animationDelay = '-' + (Math.random() * 18).toFixed(1) + 's';
      s.style.setProperty('--drift', ((Math.random() - 0.5) * 120).toFixed(0) + 'px');
      if (o.effect === 'snow') s.textContent = '❄';
      else if (o.effect === 'icons') s.textContent = o.fall[i % o.fall.length];
      else { s.style.width = size.toFixed(0) + 'px'; s.style.height = (size * 1.6).toFixed(0) + 'px'; s.style.background = confetti[i % confetti.length]; }
      box.appendChild(s);
    }
    document.body.appendChild(box);
  }

  /** Put the occasion on the page: header colours, banner, and the effect on the portal. */
  function apply(now, search) {
    now = now || new Date();
    const header = document.querySelector('.header');
    if (!header) return null;
    const { occasion: o, preview } = current(now, search);
    if (!o) return null;
    if (!preview && closedToday(o, now)) return null;

    const body = document.body;
    body.setAttribute('data-occasion', o.id);
    body.style.setProperty('--theme-header-from', o.colors[0]);
    body.style.setProperty('--theme-header-to', o.colors[1]);
    body.style.setProperty('--occasion-banner', o.colors[2]);

    const banner = document.createElement('div');
    banner.className = 'occasion-banner';
    banner.setAttribute('role', 'note');
    banner.innerHTML = `<span class="occasion-banner__icon" aria-hidden="true">${o.icons[0]}</span>`
      + `<span class="occasion-banner__text"></span>`
      + `<span class="occasion-banner__icon" aria-hidden="true">${o.icons[1]}</span>`
      + `<button type="button" class="occasion-banner__close" aria-label="Fermer le message" title="Fermer pour aujourd’hui">×</button>`;
    banner.querySelector('.occasion-banner__text').textContent = o.text + (preview ? ' (aperçu)' : '');
    banner.querySelector('.occasion-banner__close').addEventListener('click', () => {
      banner.remove();
      removeFx();
      if (!preview) store(() => localStorage.setItem(CLOSED_KEY, `${o.id}:${now.getFullYear()}-${key(now)}`));
    });
    header.insertAdjacentElement('afterend', banner);

    if (body.dataset.page === 'portal') startFx(o);
    return o;
  }

  return { LIST, easter, forDate, byId, current, apply };
})();

// The shared header (layout.js) has already drawn the page when this file loads.
if (typeof document !== 'undefined' && document.querySelector('.header')) {
  try { Occasions.apply(new Date(), window.location.search); } catch (e) { console.warn('Occasions:', e); }
}
