/**
 * kind.js - The current kind of trail within the activity (ski: uphill / downhill)
 * ===================================================================================
 * Some activities inspect more than one kind of trail, each with its own map (ski:
 * uphill on the touring map, downhill on the ski-downhill map: see
 * APP_CONFIG.networks.<id>.inspectionKinds). Kind.current() is the one the inspection
 * pages (dashboard, trail report, shelter report, history, admin) and the signalisation pages
 * (report, dashboard, management) show; the header
 * switcher (js/core/layout.js, those two apps only) lets a user switch it. An activity
 * with only one kind (bike) never shows a switcher and Kind.current() is simply that one kind.
 *
 * The choice follows the PERSON: it is saved in their profile
 * (inspectors/{uid}.preferences.kind.<activity>, the rules already let a user write their own
 * preferences), so it comes back on every device and after a logout. A copy stays in the browser
 * (orford-kind): it is used when the profile holds nothing (a choice made before this), and it
 * wins while it is "pending", that is while the profile has not confirmed it (no signal). The
 * browser's copy of one person is never applied to another one.
 *
 * Load it right after network.js. Kind.init() runs itself on "networkReady" (fired by
 * Network.setUser, called synchronously from auth.js before a page's onAuthenticated
 * callback) and fires "kindReady" in turn, so Kind.current() is safe to call any time
 * after networkReady/onAuthenticated - pages do not need to listen for "kindReady"
 * themselves unless they render something before then.
 *
 * Requires config.js (APP_CONFIG) and network.js (Network). Uses window.currentUserData and
 * window.db when they exist (the signed-in pages); without them it only uses the browser.
 */
const Kind = (function () {
  'use strict';

  const STORAGE_KEY = 'orford-kind';
  const SAVE_WAIT_MS = 1500;   // how long a switch waits for the profile before reloading anyway (no signal)
  let currentId = null;

  /** The kinds inspected by an activity (APP_CONFIG.networks.<id>.inspectionKinds). */
  function idsOf(networkId) {
    const network = APP_CONFIG.networks[networkId || Network.current()];
    return (network && network.inspectionKinds) || [];
  }

  function readChoice() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }

  function saveChoice(networkId, kind, uid, pending) {
    const choice = { network: networkId, kind };
    if (uid) choice.uid = uid;
    if (pending) choice.pending = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(choice)); } catch (e) { /* private mode */ }
  }

  const userData = () => (typeof window !== 'undefined' && window.currentUserData) || null;
  const userId = () => (userData() && userData().uid) || null;
  const profileKind = networkId => {
    const u = userData();
    return (u && u.preferences && u.preferences.kind && u.preferences.kind[networkId]) || null;
  };

  /** Writes the choice in the person's profile; null when there is no profile to write, else a promise of true (saved) or false. */
  function saveToProfile(networkId, kind) {
    const uid = userId();
    if (!uid || !window.db) return null;
    let write;
    try { write = window.db.collection('inspectors').doc(uid).update({ ['preferences.kind.' + networkId]: kind }); }
    catch (e) { write = Promise.reject(e); }
    return Promise.resolve(write).then(() => {
      saveChoice(networkId, kind, uid, false);
      return true;
    }, e => {
      console.warn('Kind: the view could not be saved in the profile; it is kept in this browser.', e);
      return false;
    });
  }

  /** Called once network.js knows the current activity ("networkReady"). */
  function init() {
    const ids = idsOf();
    const network = Network.current();
    const uid = userId();
    const local = readChoice();
    const localOk = !!local && local.network === network && ids.includes(local.kind) && (!local.uid || !uid || local.uid === uid);
    const profile = profileKind(network);
    const pending = localOk && local.pending === true && !!uid && local.uid === uid;

    if (pending) currentId = local.kind;                       // chosen here, not confirmed by the profile yet
    else if (ids.includes(profile)) currentId = profile;       // the person's own choice, on any device
    else if (localOk) currentId = local.kind;                  // this browser's choice (nothing in the profile)
    else currentId = ids[0] || null;

    if (pending) saveToProfile(network, currentId);            // try again
    document.dispatchEvent(new CustomEvent('kindReady', { detail: { current: currentId, ids: ids.slice() } }));
    return currentId;
  }

  /**
   * Switches kind (header switcher) and reloads so every page reloads its data. The page waits for the profile to be written (a reload
   * would cut the write short), but never more than SAVE_WAIT_MS: without a signal the choice is kept in the browser and written later.
   */
  function set(kind) {
    const ids = idsOf();
    if (!ids.includes(kind) || kind === currentId) return;
    const network = Network.current();
    saveChoice(network, kind, userId(), !!(userId() && window.db));
    const saving = saveToProfile(network, kind);
    if (!saving) { Network.reload(); return; }   // same hook Network.set() uses (replaceable in tests)
    return Promise.race([saving, new Promise(resolve => setTimeout(() => resolve(false), SAVE_WAIT_MS))]).then(() => { Network.reload(); });
  }

  const current = () => currentId;
  const ids = () => idsOf().slice();

  document.addEventListener('networkReady', init);

  return { current, ids, set, init };
})();
window.Kind = Kind;
