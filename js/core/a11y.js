/**
 * a11y.js - keyboard and assistive-technology helpers shared by every working page (loaded by js/core/layout.js)
 * ============================================================================================================
 * Nothing here changes how a page looks. Added 2026-11-10 after the accessibility audit (ACCESSIBILITY_AUDIT_2026-11-10.md).
 *
 * 1. WINDOWS ARE REAL DIALOGS. Every window of the app (".modal", ".detail-modal", ".inspection-modal", ".jb-modal", ".rg-modal", or anything
 *    with role="dialog") gets role="dialog", aria-modal="true" and is named by its first heading. While one is open:
 *      - the Tab key stays inside it (Tab on the last control goes back to the first, Shift+Tab the other way);
 *      - focus goes into it when it opens, and comes back to the control that opened it when it closes.
 *    The windows keep opening and closing as before (a class or a style change): this file only watches them.
 *
 * 2. CLICKABLE THINGS THAT ARE NOT BUTTONS can be reached and used with the keyboard. A div / span with an onclick attribute, and the
 *    known clickable rows and pins (".inspection-row", ".access-badge--clickable", ".user-table__name", ".map-marker"), get role="button" and
 *    tabindex="0"; Enter or Space then "clicks" them. Real buttons, links, fields and the windows' backdrops are left alone.
 *
 * Exposed for the tests: A11y.scan() (look again now), A11y.openDialog() (the window that is open and on top, or null).
 */
const A11y = (function () {
  'use strict';

  const DIALOG_SELECTOR = '.modal, .detail-modal, .inspection-modal, .jb-modal, .rg-modal, [role="dialog"]';
  const CLICKABLE_SELECTOR = '.inspection-row, .access-badge--clickable, .user-table__name, .map-marker';
  const NATIVE = /^(a|button|input|select|textarea|summary|label|option|body|html)$/i;
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const state = new WeakMap();   // dialog -> { open, opener }
  let counter = 0;
  let scheduled = false;

  const isShown = el => {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(isShown);

  // ---- dialogs -------------------------------------------------------------------------------------
  function prepareDialog(el) {
    if (!el.getAttribute('role')) el.setAttribute('role', 'dialog');
    if (!el.hasAttribute('aria-modal')) el.setAttribute('aria-modal', 'true');
    if (!el.getAttribute('aria-labelledby') && !el.getAttribute('aria-label')) {
      const heading = el.querySelector('h1, h2, h3, h4, [class*="__title"], [class*="-title"]');
      if (heading) {
        if (!heading.id) heading.id = 'dlg-title-' + (++counter);
        el.setAttribute('aria-labelledby', heading.id);
      }
    }
  }
  function openDialog() {
    const open = [...document.querySelectorAll(DIALOG_SELECTOR)].filter(el => (state.get(el) || {}).open && isShown(el));
    return open.length ? open[open.length - 1] : null;
  }
  function checkDialog(el) {
    prepareDialog(el);
    const st = state.get(el) || { open: false, opener: null };
    const shown = isShown(el);
    if (shown && !st.open) {
      // just opened: remember who opened it, then bring the focus in (unless the page already did)
      st.open = true;
      st.opener = document.activeElement && document.activeElement !== document.body && !el.contains(document.activeElement) ? document.activeElement : null;
      state.set(el, st);
      setTimeout(() => {
        if (!isShown(el) || el.contains(document.activeElement)) return;
        const first = focusables(el)[0];
        if (first) first.focus();
        else { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus(); }
      }, 150);
    } else if (!shown && st.open) {
      // just closed: give the focus back
      st.open = false;
      const opener = st.opener; st.opener = null;
      state.set(el, st);
      if (opener && opener.isConnected && isShown(opener)) setTimeout(() => { try { opener.focus(); } catch (e) { /* gone */ } }, 0);
    } else {
      state.set(el, st);
    }
  }

  // ---- keyboard-reachable clickable things ---------------------------------------------------------
  function markClickable(el) {
    if (NATIVE.test(el.tagName) || el.hasAttribute('role') || el.hasAttribute('tabindex')) return;
    if (el.matches(DIALOG_SELECTOR) || /modal|overlay|backdrop/i.test(el.className || '')) return;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (!el.getAttribute('aria-label') && el.getAttribute('title')) el.setAttribute('aria-label', el.getAttribute('title'));
  }

  function scan() {
    scheduled = false;
    document.querySelectorAll(DIALOG_SELECTOR).forEach(checkDialog);
    document.querySelectorAll(CLICKABLE_SELECTOR).forEach(markClickable);
    document.querySelectorAll('[onclick]').forEach(markClickable);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 30);   // (not requestAnimationFrame: a hidden tab or a headless browser may never call it)
  }

  document.addEventListener('keydown', event => {
    // Enter / Space on a "fake button"
    if ((event.key === 'Enter' || event.key === ' ') && event.target && event.target.getAttribute && event.target.getAttribute('role') === 'button' && !NATIVE.test(event.target.tagName)) {
      event.preventDefault();
      event.target.click();
      return;
    }
    // Tab stays inside the open window
    if (event.key !== 'Tab') return;
    const dialog = openDialog();
    if (!dialog) return;
    const items = focusables(dialog);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  function start() {
    scan();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  return { scan, openDialog };
})();
if (typeof window !== 'undefined') window.A11y = A11y;
