/**
 * kind.js - The current kind of trail within the activity (ski: uphill / downhill)
 * ===================================================================================
 * Some activities inspect more than one kind of trail, each with its own map (ski:
 * uphill on the touring map, downhill on the ski-downhill map: see
 * APP_CONFIG.networks.<id>.inspectionKinds). Kind.current() is the one the inspection
 * pages (dashboard, trail report, shelter report, history, admin) and the signalisation pages
 * (report, dashboard, management) show; the header
 * switcher (js/core/layout.js, those two apps only) lets a user switch it,
 * remembered like orford-network / orford-theme. An activity with only one kind
 * (bike) never shows a switcher and Kind.current() is simply that one kind.
 *
 * Load it right after network.js. Kind.init() runs itself on "networkReady" (fired by
 * Network.setUser, called synchronously from auth.js before a page's onAuthenticated
 * callback) and fires "kindReady" in turn, so Kind.current() is safe to call any time
 * after networkReady/onAuthenticated - pages do not need to listen for "kindReady"
 * themselves unless they render something before then.
 *
 * Requires config.js (APP_CONFIG) and network.js (Network).
 */
const Kind = (function () {
  'use strict';

  const STORAGE_KEY = 'orford-kind';
  let currentId = null;

  /** The kinds inspected by an activity (APP_CONFIG.networks.<id>.inspectionKinds). */
  function idsOf(networkId) {
    const network = APP_CONFIG.networks[networkId || Network.current()];
    return (network && network.inspectionKinds) || [];
  }

  function readChoice() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }

  function saveChoice(networkId, kind) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ network: networkId, kind })); } catch (e) { /* private mode */ }
  }

  /** Called once network.js knows the current activity ("networkReady"). */
  function init() {
    const ids = idsOf();
    const choice = readChoice();
    const network = Network.current();
    currentId = (choice && choice.network === network && ids.includes(choice.kind)) ? choice.kind : (ids[0] || null);
    document.dispatchEvent(new CustomEvent('kindReady', { detail: { current: currentId, ids: ids.slice() } }));
    return currentId;
  }

  /** Switches kind (header switcher) and reloads so every page reloads its data. */
  function set(kind) {
    const ids = idsOf();
    if (!ids.includes(kind) || kind === currentId) return;
    saveChoice(Network.current(), kind);
    Network.reload(); // same hook Network.set() uses (replaceable in tests)
  }

  const current = () => currentId;
  const ids = () => idsOf().slice();

  document.addEventListener('networkReady', init);

  return { current, ids, set, init };
})();
window.Kind = Kind;
