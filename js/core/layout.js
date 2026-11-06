/**
 * layout.js - Shared header and mobile menu for the portal
 * ==========================================================
 * Renders the skip link, header (logo, nav links, theme toggle, user menu) and
 * the mobile drawer from APP_CONFIG.nav, so the markup lives in one place.
 *
 * Load it right after <body>, after config.js, so the menus exist before
 * ui.js and theme.js initialise:
 *
 *   <body data-nav="inspection" data-page="inspection-dashboard">
 *     <script src="../js/core/config.js"></script>
 *     <script src="../js/core/layout.js"></script>
 *
 * data-nav   which set of links to use (a key of APP_CONFIG.nav)
 * data-page  the current page: shown as active, and never hidden even if admin-only
 */
(function () {
  'use strict';

  if (typeof APP_CONFIG === 'undefined' || !APP_CONFIG.nav) return;

  const body = document.body;
  const nav = APP_CONFIG.nav[body.dataset.nav];
  if (!nav) return;
  const pageId = body.dataset.page;

  // Config paths are written from the site root; siteUrl() (config.js) makes them valid from this page
  const url = path => siteUrl(path);

  // The logo + name (banner and mobile drawer) is the way back to the portal: there is no
  // separate "Portail" link in the menus any more (public-status.html has its own header).
  const PORTAL_HREF = 'index.html';
  const PROFILE = { id: 'user-profile', label: 'Mon profil', icon: '👤', href: 'pages/user-profile.html' };

  // Admin-only links start hidden; auth.js shows [data-require-admin] for admins.
  // Links that need a network feature (config: requires) start hidden too; they are
  // shown once the current network is known and has that feature (see below).
  function itemAttrs(item) {
    const attrs = [];
    if (item.admin) attrs.push('data-require-admin');
    if (item.requires) attrs.push(`data-requires="${item.requires}"`);
    if (item.admin || item.requires) attrs.push('style="display:none;"');
    return attrs.length ? ' ' + attrs.join(' ') : '';
  }

  // ---- Desktop nav ----------------------------------------------------------
  function desktopLink(item) {
    const showIcon = nav.desktopIcons !== false;
    const inner = `${showIcon ? `<span>${item.icon}</span>` : ''}<span>${item.label}</span>`;
    if (item.id === pageId) return `<span class="nav__link nav__link--active">${inner}</span>`;
    return `<a href="${url(item.href)}" class="nav__link${item.admin ? ' nav__link--admin' : ''}"${itemAttrs(item)}>${inner}</a>`;
  }

  const desktopLinks = nav.items.map(desktopLink);

  // ---- Mobile drawer --------------------------------------------------------
  function mobileLink(item) {
    const inner = `<span class="mobile-nav__link-icon">${item.icon}</span><span>${item.label}</span>`;
    if (item.id === pageId) return `<span class="mobile-nav__link mobile-nav__link--active">${inner}</span>`;
    return `<a href="${url(item.href)}" class="mobile-nav__link${item.admin ? ' mobile-nav__link--admin' : ''}"${itemAttrs(item)}>${inner}</a>`;
  }

  // Middle section of the drawer: the module's links, plus "Mon profil" on portal-level pages
  const mobileItems = nav.items.map(mobileLink);
  if (nav.mobileProfile) mobileItems.push(mobileLink(PROFILE));

  const closeIcon ='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  const menuIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';
  const moonIcon = '<svg class="theme-toggle__icon theme-toggle__icon--moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
  const sunIcon = '<svg class="theme-toggle__icon theme-toggle__icon--sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';

  // Every page shows the portal logo and name (BRANDING); apps add "  -  <app>" after the name.
  // The logo is an image when BRANDING.logoImage is set, else the emoji.
  const brand = APP_CONFIG.branding;
  const logoIcon = brand.logoImage
    ? `<img class="logo__image" src="${url(brand.logoImage)}" alt="">`
    : `<span class="logo__icon">${brand.logo}</span>`;
  // Only the logo and the name (REGIS) lead back to the portal; the app's own name ("  -  Inspections")
  // beside it is plain text, so clicking it inside an app does not leave the app.
  const portalLink = `href="${url(PORTAL_HREF)}" title="Retour au portail"`;
  const appPart = nav.title ? `<span class="logo__sep">  -  </span><span class="logo__app">${nav.title}</span>` : '';

  const html = `
    <a href="#main-content" class="skip-link">Aller au contenu principal</a>

    <header class="header">
      <div class="logo">
        <a class="logo__link" ${portalLink} aria-label="Retour au portail">${logoIcon}<span class="logo__text">${brand.name}</span></a>
        ${appPart ? `<span class="logo__text logo__rest">${appPart}</span>` : ''}
      </div>

      <nav class="nav">
        ${desktopLinks.length ? `${desktopLinks.join('\n        ')}
        <div class="nav__divider"></div>` : ''}
        <button type="button" class="network-switch" id="network-switch" hidden></button>
        <button type="button" class="network-switch" id="kind-switch" hidden></button>
        <button class="theme-toggle" onclick="window.themeManager.toggle()" aria-label="Changer le thème" title="Changer le thème">
          ${moonIcon}
          ${sunIcon}
        </button>
        <div class="user-menu">
          <button class="user-menu__trigger">
            <span class="user-menu__avatar" data-user-initials>--</span>
            <span class="user-menu__name" data-user-name>Chargement...</span>
          </button>
          <div class="user-menu__dropdown">
            <div class="user-menu__header">
              <div class="user-menu__header-name" data-user-name>-</div>
              <div class="user-menu__header-email" data-user-email>-</div>
            </div>
            <a href="${url(PROFILE.href)}" class="user-menu__item${pageId === PROFILE.id ? ' is-active' : ''}"><span>${PROFILE.icon}</span><span>${PROFILE.label}</span></a>
            <div class="user-menu__divider"></div>
            <button class="user-menu__item user-menu__item--danger" onclick="handleLogout()"><span>🚪</span><span>Déconnexion</span></button>
          </div>
        </div>
      </nav>

      <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Menu">${menuIcon}</button>
    </header>

    <div class="mobile-nav__backdrop" id="mobile-nav-backdrop"></div>
    <nav class="mobile-nav" id="mobile-nav">
      <div class="mobile-nav__header">
        <div class="mobile-nav__logo">
          <a ${portalLink} tabindex="-1" aria-hidden="true">${logoIcon}</a>
          <span class="logo__text"><a class="logo__name" ${portalLink} aria-label="Retour au portail">${brand.name}</a>${appPart}</span>
        </div>
        <button class="mobile-nav__close" id="mobile-nav-close" aria-label="Fermer">${closeIcon}</button>
      </div>

      <div class="mobile-nav__user">
        <div class="mobile-nav__user-name" data-user-name>-</div>
        <div class="mobile-nav__user-role" data-user-role>-</div>
      </div>

      <div class="mobile-nav__section" id="mobile-network" hidden>
        <div class="mobile-nav__section-title">Activité</div>
      </div>

      <div class="mobile-nav__section" id="mobile-kind" hidden>
        <div class="mobile-nav__section-title">Vue</div>
      </div>

      ${mobileItems.length ? `<div class="mobile-nav__section">
        ${mobileItems.join('\n        ')}
      </div>` : ''}
      <div class="mobile-nav__divider"></div>
      <div class="mobile-nav__section">
        <a href="#" class="mobile-nav__link" onclick="handleLogout(); return false;"><span class="mobile-nav__link-icon">🚪</span><span>Déconnexion</span></a>
      </div>

      <div class="mobile-nav__theme">
        <span class="mobile-nav__theme-label"><span>🌙</span><span>Mode sombre</span></span>
        <label class="form-switch">
          <input type="checkbox" class="form-switch__input mobile-nav__theme-toggle" id="mobile-theme-toggle" onchange="window.themeManager.toggle()">
        </label>
      </div>
    </nav>
  `;

  body.insertAdjacentHTML('afterbegin', html);

  // ---- Home-screen install ---------------------------------------------------------------------------
  // Name, icon and full-screen mode when the app is added to a phone's home screen (assets/manifest.json; the icons are made by
  // tools/make-app-icons.ps1). The portal and the login page carry the same tags in their own HTML (the page open at the moment of
  // "Add to Home Screen" gives the icon on iPhone); every other working page gets them here.
  try {
    const add = (tag, attrs) => {
      const key = tag === 'link' ? `link[rel="${attrs.rel}"]` : `meta[name="${attrs.name}"]`;
      if (document.head.querySelector(key)) return;
      const el = document.createElement(tag);
      Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
      document.head.appendChild(el);
    };
    add('link', { rel: 'manifest', href: url('assets/manifest.json') });
    add('link', { rel: 'apple-touch-icon', href: url('assets/icons/apple-touch-icon.png') });
    add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    add('meta', { name: 'apple-mobile-web-app-title', content: 'Regis' });
  } catch (e) { /* the install tags are a convenience: never block the page */ }

  // ---- Occasion themes (Noël, Nouvel An...) ------------------------------------------------------
  // Working pages only: the public pages do not use this file. js/core/occasions.js draws the
  // festive header colours and the greeting banner on the days listed in it.
  try {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = url('css/occasions.css');
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = url('js/core/occasions.js');
    document.head.appendChild(script);
  } catch (e) { /* the occasions are a decoration: never block the page */ }

  // ---- Activity (network) switcher ---------------------------------------------------
  // Filled once the user is known (network.js fires "networkReady" from auth.js). Only
  // administrators and system admins with more than one activity can use it. Switching reloads the page.
  // Everybody else follows the season (network.js): they still SEE the button with their current activity,
  // but greyed and not usable (aria-disabled rather than disabled, so the explanation tooltip still shows).
  document.addEventListener('networkReady', event => {
    const { current, allowed, canSwitch, followsSeason } = event.detail;
    const networks = APP_CONFIG.networks;

    // Links that need a network feature
    document.querySelectorAll('[data-requires]').forEach(el => {
      el.style.display = Network.feature(el.dataset.requires) ? '' : 'none';
    });

    const locked = !canSwitch && followsSeason && !!current && allowed.length >= 1;
    if (!canSwitch && !locked) return;   // an administrator with a single activity has nothing to switch

    const button = document.getElementById('network-switch');
    const section = document.getElementById('mobile-network');

    if (locked) {
      // Desktop: the current activity, greyed, a click does nothing
      const why = `L’activité suit la saison : seuls les administrateurs peuvent la changer.`;
      button.innerHTML = `<span>${networks[current].icon}</span><span>${networks[current].name}</span>`;
      button.title = `Activité : ${networks[current].name}. ${why}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-disabled', 'true');
      button.classList.add('network-switch--locked');
      button.onclick = e => { e.preventDefault(); };
      button.hidden = false;

      // Mobile: the activities listed, the current one highlighted, none can be tapped
      allowed.forEach(id => {
        const line = document.createElement('span');
        line.className = `mobile-nav__link mobile-nav__link--locked${id === current ? ' mobile-nav__link--active' : ''}`;
        line.setAttribute('aria-disabled', 'true');
        line.title = why;
        line.innerHTML = `<span class="mobile-nav__link-icon">${networks[id].icon}</span><span>${networks[id].name}</span>`;
        section.appendChild(line);
      });
      section.hidden = false;
      return;
    }

    // Desktop: one button showing the current activity; a click goes to the next one
    const next = allowed[(allowed.indexOf(current) + 1) % allowed.length];
    button.innerHTML = `<span>${networks[current].icon}</span><span>${networks[current].name}</span>`;
    button.title = `Activité : ${networks[current].name}. Passer à ${networks[next].name}`;
    button.setAttribute('aria-label', button.title);
    button.onclick = () => Network.set(next);
    button.hidden = false;

    // Mobile: one link per activity
    allowed.forEach(id => {
      const link = document.createElement('a');
      link.href = '#';
      link.className = `mobile-nav__link${id === current ? ' mobile-nav__link--active' : ''}`;
      link.innerHTML = `<span class="mobile-nav__link-icon">${networks[id].icon}</span><span>${networks[id].name}</span>`;
      link.onclick = e => { e.preventDefault(); Network.set(id); };
      section.appendChild(link);
    });
    section.hidden = false;
  });

  // ---- Kind switcher (uphill/downhill for ski) ---------------------------------------------
  // Only on the inspection and signalisation pages, and only when the activity has more than one
  // kind (kind.js fires "kindReady" once network.js knows the activity). Switching reloads the
  // page, like the activity switch above, so every page of those two apps picks it up the same
  // way without each one needing its own toggle.
  document.addEventListener('kindReady', event => {
    const { current, ids } = event.detail;
    if ((nav !== APP_CONFIG.nav.inspection && nav !== APP_CONFIG.nav.signalisation) || ids.length < 2) return;

    const label = id => TrailService.kindLabel(id);
    const icon = id => { const m = APP_CONFIG.maps[TrailService.mapIdOf(id)]; return m ? m.icon : ''; };

    // Desktop: one button showing the current kind; a click goes to the next one
    const button = document.getElementById('kind-switch');
    const next = ids[(ids.indexOf(current) + 1) % ids.length];
    button.innerHTML = `<span>${icon(current)}</span><span>${label(current)}</span>`;
    button.title = `Vue : ${label(current)}. Passer à ${label(next)}`;
    button.setAttribute('aria-label', button.title);
    button.onclick = () => Kind.set(next);
    button.hidden = false;

    // Mobile: one link per kind
    const section = document.getElementById('mobile-kind');
    ids.forEach(id => {
      const link = document.createElement('a');
      link.href = '#';
      link.className = `mobile-nav__link${id === current ? ' mobile-nav__link--active' : ''}`;
      link.innerHTML = `<span class="mobile-nav__link-icon">${icon(id)}</span><span>${label(id)}</span>`;
      link.onclick = e => { e.preventDefault(); Kind.set(id); };
      section.appendChild(link);
    });
    section.hidden = false;
  });
})();
