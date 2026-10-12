/**
 * network.js - The current activity (network) for the portal
 * ===========================================================
 * Which activity (ski, bike, ...) the user is working in, and what that
 * activity has (map, shelters, ...). Settings live in APP_CONFIG.networks.
 *
 * Load it right after config.js (before layout.js). auth.js calls
 * Network.setUser(userData) once the user is known, so pages can rely on
 * Network.current() inside checkAuthStatus' onAuthenticated callback.
 *
 * Which activity is current, in order:
 *   1. the user's own choice (header switcher), if it is one of their
 *      activities AND was made during the current season. A choice made last
 *      season is ignored, so nobody opens the ski app in July because of
 *      what they picked last winter;
 *   2. the season's activity (APP_CONFIG.networks[id].season), if allowed;
 *   3. the first activity the user has.
 * A user's activities are inspectors/{uid}.networks (a system_admin has all).
 */
const Network = (function () {
  'use strict';

  const STORAGE_KEY = 'orford-network';
  const ids = Object.keys(APP_CONFIG.networks);
  let allowed = [];
  let currentId = null;

  // ---- Season -----------------------------------------------------------------
  // A season is { from: {month, day}, to: {month, day} } (config.js); it may run over New Year.
  const mmdd = (month, day) => month * 100 + day;
  function dateInSeason(season, date) {
    const value = mmdd(date.getMonth() + 1, date.getDate());
    const from = mmdd(season.from.month, season.from.day);
    const to = mmdd(season.to.month, season.to.day);
    return from <= to ? (value >= from && value <= to) : (value >= from || value <= to);
  }

  // The network whose season includes the date; otherwise the default one
  function ofSeason(date) {
    const day = date || api.now();
    const inSeason = ids.find(id => APP_CONFIG.networks[id].season && dateInSeason(APP_CONFIG.networks[id].season, day));
    return inSeason || APP_CONFIG.defaultNetworks[0];
  }

  // ---- The user's own choice ----------------------------------------------------
  function readChoice() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }

  function saveChoice(id) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, season: ofSeason() })); } catch (e) { /* private mode */ }
  }

  function allowedFor(userData) {
    if (!userData) return [];
    if (userData.role === 'system_admin') return ids.slice();
    return (Array.isArray(userData.networks) ? userData.networks : []).filter(id => ids.includes(id));
  }

  // ---- Public API -----------------------------------------------------------------

  /** Called by auth.js once the user is known. Returns the current network id (or null). */
  function setUser(userData) {
    allowed = allowedFor(userData);
    const season = ofSeason();
    const choice = readChoice();

    if (choice && choice.season === season && allowed.includes(choice.id)) currentId = choice.id;
    else if (allowed.includes(season)) currentId = season;
    else currentId = allowed[0] || null;

    if (currentId) document.body.dataset.network = currentId;
    document.dispatchEvent(new CustomEvent('networkReady', { detail: { current: currentId, allowed: allowed.slice() } }));
    return currentId;
  }

  /** Public pages (no login): the season's network, or ?network=bike to look at another one. */
  function usePublic() {
    const asked = new URLSearchParams(window.location.search).get('network');
    currentId = ids.includes(asked) ? asked : ofSeason();
    allowed = [currentId];
    document.body.dataset.network = currentId;
    return currentId;
  }

  /** Switches activity (header switcher) and reloads so every page reloads its data. */
  function set(id) {
    if (!allowed.includes(id) || id === currentId) return;
    saveChoice(id);
    api.reload();
  }

  const current = () => currentId;
  const config = () => APP_CONFIG.networks[currentId] || null;

  /** Does the current network have a feature (shelters, snowCondition, ...)? */
  function feature(name) {
    const c = config();
    return !!(c && c.features && c.features[name]);
  }

  /** The network of a record. */
  const of = doc => doc && doc.network;
  const matches = doc => of(doc) === currentId;
  const filter = docs => docs.filter(matches);

  /**
   * The latest season of an activity (default: the current one) that has started: its start, its
   * end (end of day) and whether it is running now. One rule for ski (1 Nov - 30 Apr) and bike
   * (1 May - 31 Oct): out of season it is the season that just ended (ski in July = last winter).
   * Pages that would otherwise read a whole collection (dashboard, history) only read from its
   * start; the statistics page navigates by season; the export proposes its start.
   */
  function seasonRange(networkId, at) {
    const season = (APP_CONFIG.networks[networkId || currentId] || APP_CONFIG.networks[APP_CONFIG.defaultNetworks[0]]).season;
    const now = at || api.now();
    let start = new Date(now.getFullYear(), season.from.month - 1, season.from.day);
    if (start > now) start = new Date(now.getFullYear() - 1, season.from.month - 1, season.from.day);
    const runsOverNewYear = mmdd(season.to.month, season.to.day) < mmdd(season.from.month, season.from.day);
    const end = new Date(start.getFullYear() + (runsOverNewYear ? 1 : 0), season.to.month - 1, season.to.day, 23, 59, 59, 999);
    return { start, end, active: now <= end };
  }

  function seasonStart(networkId) {
    return seasonRange(networkId).start;
  }

  /** "Saison en cours (depuis le 1 nov. 2025)" or, out of season, "Dernière saison (1 nov. 2025 – 30 avr. 2026)". */
  function seasonLabel(range) {
    const fmt = d => d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
    return range.active ? `Saison en cours (depuis le ${fmt(range.start)})` : `Dernière saison (${fmt(range.start)} – ${fmt(range.end)})`;
  }
  /** The Météo app's symbol for a date (default: today): the snowflake in the ski season, the sun in the bike season. */
  function seasonIcon(date) {
    return APP_CONFIG.networks[ofSeason(date)].weatherIcon || '🌦️';
  }

  /** A path from the site root ("assets/map/Ski-Touring_Map.png") as a URL valid from the current page. */
  function url(path) {
    return siteUrl(path); // config.js: independent of where the site is hosted
  }

  const api = {
    ids, ofSeason, setUser, usePublic, set,
    current, config, feature,
    of, matches, filter, url, seasonRange, seasonStart, seasonLabel, seasonIcon,
    // Replaceable in tests
    now: () => new Date(),
    reload: () => window.location.reload()
  };
  return api;
})();
window.Network = Network;
