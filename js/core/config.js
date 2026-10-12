/**
 * config.js - Main Configuration for the portal
 * ==============================================
 * Central configuration file for branding, Firebase, and app settings.
 *
 * TO CUSTOMIZE THE APP:
 * - Rename the portal / change its logo: edit BRANDING just below (nothing else)
 * - Firebase config should match your project
 */

// ===== WHERE THE SITE IS HOSTED =====
// Nothing here depends on the address the site is published at (domain, repository sub-folder,
// local folder...). The site root is derived from where THIS script was loaded from
// (<root>/js/core/config.js), and siteUrl() turns any path written from the site root
// ("index.html", "pages/login.html", "assets/map/x.png") into a URL valid from the current page.
// Moving the site to another address needs no change to the files.
const SITE_ROOT_URL = (() => {
  const own = document.currentScript
    || [...document.scripts].find(s => /\/js\/core\/config\.js(\?|#|$)/.test(s.src));
  if (own && own.src) return new URL('../../', own.src).href;
  // Last resort (script injected without a trace): the folder above "pages/", or the current folder
  return new URL(window.location.pathname.includes('/pages/') ? '../' : './', window.location.href).href;
})();

// The relative link from the page at pageUrl to `path` (written from the site root at rootUrl)
function relativeSiteUrl(rootUrl, pageUrl, path) {
  const target = new URL(path, rootUrl);
  const there = target.pathname.split('/');
  const file = there.pop();
  const here = new URL('./', pageUrl).pathname.split('/');
  here.pop(); // the empty part after the trailing slash
  let common = 0;
  while (common < here.length && common < there.length && here[common] === there[common]) common++;
  return '../'.repeat(here.length - common) + [...there.slice(common), file].join('/') + target.search + target.hash;
}

function siteUrl(path) {
  return relativeSiteUrl(SITE_ROOT_URL, window.location.href, path);
}

// ===== BRANDING: the ONE place for the portal's name and logo =====
// The header logo, the browser tab title and description, the favicon and the login page
// all read this (see "Apply the branding" at the end of this file). Pages only write their
// own part of the title ("Connexion"); the name is added for them.
// Do NOT rename the localStorage keys 'orford-theme' / 'orford-network' (js/core/theme.js,
// network.js): they are invisible to users and renaming them would reset everyone's settings.
const BRANDING = {
  name: 'Regis',                   // trial name
  logo: '🏔️',                     // emoji, used when there is no logoImage
  logoImage: 'assets/Logo_Mont-Orford transparent.png', // path from the site root (far left of the header; needs a transparent background), or null for the emoji
  tagline: 'Patrouille Mont Orford',
  footerText: '© 2026 Regis for Mont Orford'
};

const APP_CONFIG = {
  branding: BRANDING,

  // ===== FIREBASE CONFIGURATION =====
  firebase: {
    apiKey: "AIzaSyDcBZrwGTskM7QUvanzLTACEJ_T-55j-DA",
    authDomain: "trail-inspection.firebaseapp.com",
    projectId: "trail-inspection",
    storageBucket: "trail-inspection.firebasestorage.app",
    messagingSenderId: "415995272058",
    appId: "1:415995272058:web:dc476de8ffee052e2ad4c3",
    measurementId: "G-EBLYWBM9YB"
  },

  // ===== WEATHER (Météo app, js/services/weather-service.js) =====
  // Environment Canada's near-real-time observations (hourly, public, no key). A place ("location") has
  // stations, best first: a value comes from the FIRST station that has it. publish: false = the station's values
  // only help the person typing in the office (the airport data carries a NAV CANADA "all rights reserved"
  // notice): they are stored but never put on the public page. More places can be added later.
  //   profile  'ground' = a plain weather station, 'airport' = an airport (adds pressure, clouds, visibility)
  weather: {
    api: 'https://api.weather.gc.ca/collections/swob-realtime/items',
    maxAgeHours: 3,                 // an observation older than this (before the chosen time) is not offered
    defaultLocation: 'mountain',
    // The choices of the fields typed by hand (the customer's sheet): id -> words shown. The id is what is
    // stored, so a word can be changed here without touching the readings already saved; do not change an id
    // that is already used. The order here is the order of the drop-down.
    lists: {
      windForce:  { nul: 'Nul', faible: 'Faible', moyen: 'Moyen', fort: 'Fort', 'tres-fort': 'Très fort' },
      snowType:   { 'poudreuse-legere': 'Poudreuse légère', 'poudreuse-lourde': 'Poudreuse lourde', granulaire: 'Granulaire', mouillee: 'Neige mouillée', croutee: 'Croûtée', glacee: 'Glacée', printaniere: 'Printanière' },
      snowBase:   { solide: 'Solide', variable: 'Variable', mou: 'Mou', glace: 'Glacé', mince: 'Mince' },
      snowCover:  { excellente: 'Excellente', bonne: 'Bonne', 'endroits-a-decouvert': 'Endroits à découvert', insuffisante: 'Insuffisante' }
    },
    locations: {
      mountain: {
        id: 'mountain', name: 'Mont Orford',
        stations: [
          { id: 'lac', name: 'Lac Memphrémagog', mscId: '702CFGG', profile: 'ground', publish: true },
          { id: 'sherbrooke', name: 'Aéroport de Sherbrooke', mscId: '7028123', profile: 'airport', publish: false }
        ]
      }
    }
  },

  // ===== VERSION =====
  version: new Date().toISOString().split('T')[0].replace(/-/g, ''),
  
  // ===== MAPS =====
  // Each map: image (path from the site root) and its size in pixels. Trail coordinates are
  // pixels on that image, so keep its size once trails are placed on it. The GPS calibration
  // is not here: the system admin saves it in Administration > Cartes (Firestore maps/{id}).
  // No calibration = GPS positions cannot be drawn on that map (Google Maps links still work).
  // The ids 'ski' and 'bike' are also the ids of the calibrations saved before there were
  // several maps: do not rename them.
  //   Ski-Downhill_Map_web.jpg is Ski-Downhill_Map.png (same 1670 x 736 px) as a lighter JPG.
  // Every kind of trail has a status map (trailKinds.<kind>.map: trail markers, open/closed) and
  // a geolocalisation map (trailKinds.<kind>.geoMap: GPS-calibrated, report/photo locations only -
  // never has trail status markers placed on it). The two are always separate images, even where
  // they show the same area, so a geolocalisation map's calibration is never disturbed by trail
  // marker edits and vice versa.
  maps: {
    'ski':              { name: 'Ski - Montée (statut)',   icon: '⛷️', image: 'assets/map/Ski-Touring_Map.png',                          width: 800,  height: 700 },
    // Ski-Touring_geolocalisation_Map_web.jpg is Ski-Touring_geolocalisation_Map.png (same 800 x 700 px) as a lighter JPG.
    'ski-geo':          { name: 'Ski - Montée (géolocalisation)', icon: '📍', image: 'assets/map/Ski-Touring_geolocalisation_Map_web.jpg', width: 800,  height: 700 },
    // Ski-Downhill_Map_web.jpg is Ski-Downhill_Map.png (same 1670 x 736 px) as a lighter JPG.
    'ski-downhill':     { name: 'Ski - Descente (statut)', icon: '🎿', image: 'assets/map/Ski-Downhill_Map_web.jpg',                       width: 1670, height: 736 },
    // Ski-Downhill_Geolocalisation-map_web.jpg is Ski-Downhill_Geolocalisation-map.png (same 1404 x 932 px) as a lighter JPG.
    'ski-downhill-geo': { name: 'Ski - Descente (géolocalisation)', icon: '📍', image: 'assets/map/Ski-Downhill_Geolocalisation-map_web.jpg', width: 1404, height: 932 },
    // The illustrated map (Bike_Map.jpg, not to scale) resized to 1600 px wide
    'bike':             { name: 'Vélo (statut)',            icon: '🚵', image: 'assets/map/Bike_Map_web.jpg',                             width: 1600, height: 919 },
    'bike-geo':         { name: 'Vélo (géolocalisation)',   icon: '📍', image: 'assets/map/Bike_Geolocalisation_Map_web.jpg',              width: 1600, height: 919 }
  },

  // ===== NETWORKS (activities) =====
  // A user's access is the list of these ids in inspectors/{uid}.networks.
  // defaultNetworks[0] is what a CSV import gives users when its networks column is empty,
  // and the network used when no activity is in season (see js/core/network.js ofSeason).
  //
  // Per network:
  //   season        { from: {month, day}, to: {month, day} } - THE definition of the activity's season,
  //                 used everywhere: which activity opens by default on a given date (header, public
  //                 status page), the window the dashboard and history read, the seasons of the admin
  //                 statistics, the default start date of the data export. A season may run over New
  //                 Year (ski: 1 Nov to 30 Apr). See js/core/network.js (seasonRange, ofSeason).
  //   map           id of the network's main map (in maps above), the one behind the inspection
  //                 markers and the report locations. Trails of another kind can use another
  //                 map: see trailKinds.<kind>.map
  //   trailKinds    the kinds of trail this activity has (keys of trailKinds below)
  //   reportMaps    the maps (ids of maps above) the report locations (infractions, signalisations)
  //                 can be shown on, the default one first; several = a switch between them
  //   inspectionKinds  the kinds that are inspected, and shown on the public status page and the
  //                 inspection dashboard. More than one (ski: uphill + downhill) means a kind
  //                 toggle is shown there, since each kind has its own map.
  //   features      what the network has: shelters, snowCondition (ski-only inspection field)
  //   infractions   the fault types and practices offered on the infraction form (id -> label)
  //   publicTitle   what the public status page calls this activity's trails
  //   weatherIcon   the Météo app's symbol while the season runs (ski: snowflake, bike: sun)
  networks: {
    ski: {
      id: 'ski', name: 'Ski', icon: '⛷️',
      weatherIcon: '❄️',   // symbol of the Météo app while this activity's season runs (Network.seasonIcon)
      season: { from: { month: 11, day: 1 }, to: { month: 4, day: 30 } }, // 1 November to 30 April
      map: 'ski',
      trailKinds: ['uphill', 'downhill', 'lift'],
      reportMaps: ['ski-downhill-geo', 'ski-geo'],
      inspectionKinds: ['uphill', 'downhill'],
      features: { shelters: true, snowCondition: true },
      publicTitle: 'État des sentiers de randonnée alpine',
      infractions: {
        faults: {
          'downhill': 'Downhill',
          'saut-dangereux': 'Saut dangereux',
          'ski-hors-piste': 'Ski hors piste',
          'ski-piste-fermee': 'Ski piste fermée',
          'saut-des-chaises': 'Saut des chaises',
          'manoeuvre-dangereuse': 'Manoeuvre dangereuse',
          'autres': 'Autres (voir commentaire)'
        },
        practices: { 'ski': 'Ski', 'snowboard': 'Snowboard', 'raquette': 'Raquette', 'autres': 'Autres' }
      }
    },
    bike: {
      id: 'bike', name: 'Vélo', icon: '🚵',
      weatherIcon: '☀️',
      season: { from: { month: 5, day: 1 }, to: { month: 10, day: 31 } }, // 1 May to 31 October
      map: 'bike',
      trailKinds: ['bike'],
      reportMaps: ['bike-geo'],
      inspectionKinds: ['bike'],
      features: { shelters: false, snowCondition: false },
      publicTitle: 'État des sentiers de vélo de montagne',
      infractions: {
        faults: {
          'acces-non-accredite': 'Utilise une piste sans droit d\'accès accrédité',
          'deterioration': 'Détériore les pistes / signalisation',
          'autres': 'Autre (voir commentaires)'
        },
        practices: { 'velo': 'Vélo', 'autres': 'Autres' }
      }
    }
  },
  defaultNetworks: ['ski'],

  // The earliest season the admin Statistiques tab's season navigator can go back to, for every
  // activity (winter 2025-2026: when the app went live - nothing meaningful exists before it).
  // A season (see pages/inspection-admin.html and each network's season above) is
  // reachable only if it STARTS on or after this date; "Previous" disables itself once going back
  // one more season would start earlier than this.
  earliestSeasonStart: { year: 2025, month: 9, day: 1 },

  // ===== TRAILS =====
  // trails/{id}: name, number (optional, shown on the map markers), kind, network, difficulty,
  // length (km, optional, information only), status ('open' | 'closed'), coordinates
  // ({left, top}: pixels on the map of its kind), sector (id of a sector: the area the infraction and
  // signalisation forms list it under; set by a system admin), archived (true = hidden: no longer part of the
  // network, kept for the history). Uphill and downhill are separate records even when they
  // follow the same path: they have their own number, status and difficulty.
  // A trail saved before `kind` existed is uphill (bike network: bike); one saved with the
  // old difficulty easy / medium / hard is green / blue / black (see js/services/trail-service.js).
  // idPrefix: new trails are numbered trail_12, run_1, bike_3...
  // map: the map (in maps above) the trails of this kind are placed on (status markers, open/closed).
  // geoMap: the map (GPS-calibrated) this kind's photo locations (inspection dashboard/history) are
  // placed on, when different from `map`. Falls back to `map` when absent (see TrailService.geoMapIdOf).
  // issues: the checklist offered by the inspection form's "Problèmes identifiés" section (an
  // inspector can also type a free-text "other" issue on top of it). No entry = no checklist
  // (lift: never inspected, see inspectionKinds).
  trailKinds: {
    uphill:   { label: 'Montée',   idPrefix: 'trail', map: 'ski', geoMap: 'ski-geo',
      issues: ['Glace sur le sentier', 'Érosion du sentier', 'Arbres/branches tombés', 'Obstacles sur le sentier', 'Signalisation manquante/endommagée'] },
    downhill: { label: 'Descente', idPrefix: 'run',   map: 'ski-downhill', geoMap: 'ski-downhill-geo',
      issues: ['Plaques de glace / verglas', 'Manque de neige / roches exposées', 'Arbres/branches tombés sur la piste', 'Filet de sécurité endommagé', 'Balisage de piste manquant/endommagé'] },
    bike:     { label: 'Vélo',     idPrefix: 'bike',  map: 'bike', geoMap: 'bike-geo',
      issues: ['Ornières / érosion importante', 'Arbres/branches tombés sur le sentier', 'Pont/passerelle endommagé', 'Obstacle technique endommagé (saut, module, virage relevé)', 'Signalisation manquante/endommagée', 'Boue excessive / sentier détrempé'] },
    // Lifts (Remontées mécaniques): listed so reports can be filed against them; no difficulty,
    // never inspected (see inspectionKinds)
    lift:     { label: 'Remontée', idPrefix: 'lift',  map: 'ski-downhill', geoMap: 'ski-downhill-geo' }
  },
  difficulties: {
    'green':        { label: 'Verte',        icon: '🟢' },
    'blue':         { label: 'Bleue',        icon: '🔵' },
    'black':        { label: 'Noire',        icon: '⚫' },
    'double-black': { label: 'Double noire', icon: '⚫⚫' }
  },
  // The difficulties each kind of trail can have, easiest first
  difficultyScales: {
    uphill:   ['green', 'blue', 'black'],
    downhill: ['green', 'blue', 'black', 'double-black'],
    bike:     ['green', 'blue', 'black', 'double-black'],
    lift:     []
  },

  // ===== LABELS shared by the apps =====
  // trail status (what is open or closed) and inspection condition (what state it is in)
  labels: {
    trailStatus: {
      open:    { label: 'Ouvert',  icon: '🟢' },
      closed:  { label: 'Fermé',   icon: '🔴' },
      unknown: { label: 'Inconnu', icon: '❓' }
    },
    condition: {
      'good':          { label: 'Bon état',          icon: '✅' },
      'warning':       { label: 'Attention requise', icon: '⚠️' },
      'critical':      { label: 'État critique',     icon: '❌' },
      'not-inspected': { label: 'Non inspecté',      icon: '⚪' },
      'unknown':       { label: 'Inconnu',           icon: '❓' }
    }
  },

  // ===== NAVIGATION (rendered by js/core/layout.js) =====
  // One set per module, chosen with <body data-nav="...">. The current page is
  // <body data-page="...">. Paths are relative to the site root.
  // The header always shows the portal logo and name (BRANDING); title: 'Inspections' adds
  // "  -  Inspections" after the name (no title on the portal and profile pages).
  // admin: true = only shown to admins (unless it is the current page).
  // desktopIcons: false = the desktop bar shows labels only (mobile always has icons).
  // requires: 'shelters' = only shown when the current network has that feature.
  // mobileProfile: true = the mobile drawer lists "Mon profil" (only on portal-level pages;
  // in the apps it stays in the desktop user menu).
  nav: {
    portal: {
      mobileProfile: true,
      items: []
    },
    inspection: {
      title: 'Inspections',
      desktopIcons: false,
      items: [
        { id: 'inspection-dashboard', label: 'Tableau de bord', icon: '📊', href: 'pages/inspection-dashboard.html' },
        { id: 'inspection-trail-report', label: 'Rapport sentier', icon: '📝', href: 'pages/inspection-trail-report.html' },
        { id: 'inspection-shelter-report', label: 'Rapport abri', icon: '📝', href: 'pages/inspection-shelter-report.html', requires: 'shelters' },
        { id: 'inspection-history', label: 'Gestion', icon: '📋', href: 'pages/inspection-history.html' },
        { id: 'inspection-admin', label: 'Admin', icon: '⚙️', href: 'pages/inspection-admin.html', admin: true }
      ]
    },
    infraction: {
      title: 'Infractions',
      items: [
        { id: 'infraction-report', label: 'Rapport', icon: '📝', href: 'pages/infraction-report.html' },
        { id: 'infraction-admin', label: 'Gestion', icon: '📋', href: 'pages/infraction-admin.html', admin: true },
        { id: 'infraction-stats', label: 'Admin', icon: '⚙️', href: 'pages/infraction-stats.html', admin: true }
      ]
    },
    signalisation: {
      title: 'Signalisations',
      items: [
        { id: 'signalisation-resume', label: 'Tableau de bord', icon: '🗺️', href: 'pages/signalisation-resume.html' },
        { id: 'signalisation-report', label: 'Rapport', icon: '📝', href: 'pages/signalisation-report.html' },
        { id: 'signalisation-admin', label: 'Gestion', icon: '📋', href: 'pages/signalisation-admin.html' },   // read-only history for non-admins
        { id: 'signalisation-stats', label: 'Admin', icon: '⚙️', href: 'pages/signalisation-stats.html', admin: true }
      ]
    },
    maintenance: {
      title: 'Entretien',
      items: [
        { id: 'maintenance-report', label: 'Rapport', icon: '📝', href: 'pages/maintenance-report.html' },
        { id: 'maintenance-admin', label: 'Gestion', icon: '📋', href: 'pages/maintenance-admin.html' },   // read-only history for non-admins
        { id: 'maintenance-stats', label: 'Admin', icon: '⚙️', href: 'pages/maintenance-stats.html', admin: true }
      ]
    },
    meteo: {
      title: 'Météo',
      items: [
        { id: 'meteo-report', label: 'Relevés', icon: '🌡️', href: 'pages/meteo-report.html' },
        { id: 'meteo-stats', label: 'Admin', icon: '⚙️', href: 'pages/meteo-stats.html', admin: true }
        // no separate "Gestion": readings are listed, corrected (and deleted by the system admin) on the Relevés page
      ]
    },
    support: {
      title: 'Support',
      items: []
    },
    admin: {
      title: 'Administration',
      mobileProfile: true,
      items: []
    },
    profile: {
      mobileProfile: true,
      items: []
    }
  }
};

// Freeze config to prevent accidental modification
Object.freeze(APP_CONFIG);
Object.freeze(APP_CONFIG.branding);
Object.freeze(APP_CONFIG.firebase);
Object.freeze(APP_CONFIG.nav);
Object.freeze(APP_CONFIG.maps);
Object.freeze(APP_CONFIG.networks);
Object.freeze(APP_CONFIG.defaultNetworks);
Object.freeze(APP_CONFIG.trailKinds);
Object.freeze(APP_CONFIG.difficulties);
Object.freeze(APP_CONFIG.difficultyScales);
Object.freeze(APP_CONFIG.labels);

// ===== Apply the branding to the page (browser only) =====
// - <title>: "<name> - <page's own text>"; <meta name="description">: "<page's own text> - <name>"
//   (each skipped if the tag has data-no-brand, or already contains the name)
// - <link rel="icon" data-brand>: the logo image, or the emoji drawn as an icon
// - [data-brand-name] / [data-brand-tagline] / [data-brand-logo]: filled in (login page)
(function applyBranding() {
  if (typeof document === 'undefined') return;
  const brand = APP_CONFIG.branding;

  const title = document.querySelector('title');
  if (title && !title.hasAttribute('data-no-brand') && !title.textContent.includes(brand.name)) {
    title.textContent = `${brand.name} - ${title.textContent}`; // "Regis - Administration"
  }
  const description = document.querySelector('meta[name="description"]');
  if (description && !description.hasAttribute('data-no-brand') && !description.content.includes(brand.name)) {
    description.content = `${description.content} - ${brand.name}`;
  }

  document.querySelectorAll('link[rel="icon"][data-brand]').forEach(link => {
    link.href = brand.logoImage
      ? siteUrl(brand.logoImage)
      : 'data:image/svg+xml,' + encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${brand.logo}</text></svg>`);
  });

  const fill = () => {
    document.querySelectorAll('[data-brand-name]').forEach(el => { el.textContent = brand.name; });
    document.querySelectorAll('[data-brand-tagline]').forEach(el => { el.textContent = brand.tagline; });
    document.querySelectorAll('[data-brand-logo]').forEach(el => {
      el.textContent = '';
      if (brand.logoImage) {
        const image = document.createElement('img');
        image.src = siteUrl(brand.logoImage);
        image.alt = brand.name;
        el.appendChild(image);
      } else {
        el.textContent = brand.logo;
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill); else fill();
})();

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = APP_CONFIG;
}
