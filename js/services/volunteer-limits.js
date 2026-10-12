/**
 * VolunteerLimits - limits on the PUBLIC volunteer registration page (no login there).
 *
 * The limits are global (every visitor together): per minute, per hour, per day and in total. They are
 * enforced by the Firestore rules (see "VOLUNTEER SIGN-UP LIMITS" in assets/Rules for Firebase.txt), not by
 * this code, so a script that skips the page is stopped too. This module is the client side of that contract:
 *
 *   volunteerLimits/config   { perMinute, perHour, perDay, total, enabled }   written by an admin; DEFAULTS while missing
 *   volunteerLimits/state    the counters: { total, minuteStart, minuteCount, hourStart, hourCount, dayStart,
 *                            dayCount, lastVolunteerId, updatedAt }
 *
 * A registration is ONE write batch: the new counters (each +1) AND the volunteer, whose id is written in
 * state.lastVolunteerId. The rules accept the counters only together with that new volunteer, and the volunteer
 * only together with those counters, so neither can happen alone.
 *
 * A window (minute / hour / day) starts at the first registration and lasts its length; a registration after
 * that starts a new window (count 1, start = server time). The client decides "still running or expired" with its
 * own clock; if that was wrong (clock skew, or another visitor registered in between) the rules refuse the batch
 * and register() tries again with fresh counters.
 *
 * Needs: nothing but a Firestore `db` and the `firebase` namespace (public page: no login, no config beyond Firebase).
 */
const VolunteerLimits = (() => {
  const COLLECTION = 'volunteerLimits';
  const DEFAULTS = Object.freeze({ perMinute: 10, perHour: 60, perDay: 150, total: 500, enabled: true });
  const MAX_LIMIT = 100000;
  const WINDOWS = [
    { id: 'minute', secs: 60, limit: 'perMinute', start: 'minuteStart', count: 'minuteCount' },
    { id: 'hour', secs: 3600, limit: 'perHour', start: 'hourStart', count: 'hourCount' },
    { id: 'day', secs: 86400, limit: 'perDay', start: 'dayStart', count: 'dayCount' }
  ];
  // Clock offsets tried in turn (ms). 0 twice: the second try is for another visitor registering at the same time.
  const ATTEMPT_SHIFTS_MS = [0, 0, 120000, -120000];

  let nowFn = () => Date.now();

  function ms(t) {
    if (t === null || t === undefined) return null;
    if (typeof t === 'number') return t;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.toDate === 'function') return t.toDate().getTime();
    if (t instanceof Date) return t.getTime();
    return null;
  }

  const stateRef = db => db.collection(COLLECTION).doc('state');
  const configRef = db => db.collection(COLLECTION).doc('config');

  function limitValue(v, fallback) {
    return Number.isInteger(v) && v >= 1 && v <= MAX_LIMIT ? v : fallback;
  }

  /** The limits in force (the document, field by field, over the defaults). Never throws on a missing document. */
  async function config(db) {
    const snap = await configRef(db).get();
    const d = snap.exists ? snap.data() : {};
    return {
      perMinute: limitValue(d.perMinute, DEFAULTS.perMinute),
      perHour: limitValue(d.perHour, DEFAULTS.perHour),
      perDay: limitValue(d.perDay, DEFAULTS.perDay),
      total: limitValue(d.total, DEFAULTS.total),
      enabled: d.enabled !== false
    };
  }

  async function readState(db) {
    const snap = await stateRef(db).get();
    return snap.exists ? snap.data() : {};
  }

  /** Where the counters stand at `now`: used / limit per window, when each resets, and why a registration would be refused. */
  function view(cfg, st, now) {
    const out = { enabled: cfg.enabled, total: { used: st.total || 0, limit: cfg.total }, blocked: null };
    WINDOWS.forEach(w => {
      const start = ms(st[w.start]);
      const alive = start !== null && now < start + w.secs * 1000;
      out[w.id] = { used: alive ? (st[w.count] || 0) : 0, limit: cfg[w.limit], resetAt: alive ? start + w.secs * 1000 : null };
    });
    if (!cfg.enabled) out.blocked = 'disabled';
    else if (out.total.used >= out.total.limit) out.blocked = 'total';
    else if (out.day.used >= out.day.limit) out.blocked = 'day';
    else if (out.hour.used >= out.hour.limit) out.blocked = 'hour';
    else if (out.minute.used >= out.minute.limit) out.blocked = 'minute';
    return out;
  }

  /** The counters after one more registration (what the rules expect). `ts` is the server-timestamp value. */
  function nextState(st, now, volunteerId, ts) {
    const next = { total: (st.total || 0) + 1, lastVolunteerId: volunteerId, updatedAt: ts };
    WINDOWS.forEach(w => {
      const start = ms(st[w.start]);
      const alive = start !== null && now < start + w.secs * 1000;
      next[w.start] = alive ? st[w.start] : ts;     // a running window keeps its start (the very same value)
      next[w.count] = alive ? (st[w.count] || 0) + 1 : 1;
    });
    return next;
  }

  function hhmm(t) {
    return new Date(t).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  }

  /** The visitor's message for a refusal reason ('disabled', 'total', 'day', 'hour', 'minute', 'network', 'unknown'). */
  function message(reason, v) {
    const contact = 'Veuillez communiquer avec la patrouille.';
    switch (reason) {
      case 'disabled': return `Les inscriptions sont momentanément fermées. ${contact}`;
      case 'total': return `Le nombre maximal d'inscriptions est atteint. ${contact}`;
      case 'day': return `Le nombre d'inscriptions permises pour aujourd'hui est atteint. Veuillez réessayer${v && v.day.resetAt ? ' après ' + hhmm(v.day.resetAt) : ' plus tard'} ou communiquer avec la patrouille.`;
      case 'hour': return `Le nombre d'inscriptions permises pour cette heure est atteint. Veuillez réessayer${v && v.hour.resetAt ? ' après ' + hhmm(v.hour.resetAt) : ' plus tard'}.`;
      case 'minute': return "Trop d'inscriptions en peu de temps. Veuillez réessayer dans une minute.";
      case 'network': return 'Connexion impossible. Vérifiez votre connexion Internet et réessayez.';
      default: return `L'inscription n'a pas pu être enregistrée. Veuillez réessayer dans quelques minutes ou communiquer avec la patrouille.`;
    }
  }

  /** Public page, on load: is a registration possible right now? A read failure never blocks the form. */
  async function check(db) {
    try {
      const v = view(await config(db), await readState(db), nowFn());
      return { blocked: v.blocked, message: v.blocked ? message(v.blocked, v) : '', view: v };
    } catch (e) {
      return { blocked: null, message: '', view: null };
    }
  }

  /**
   * Registers a volunteer: { nom, prenom }. Returns { ok: true } or { ok: false, reason, message, view }.
   * The registration is refused by the rules when a limit is reached or the switch is off; the reason is
   * worked out from fresh counters so the visitor reads what actually happened.
   */
  async function register(db, fb, person) {
    const serverTs = () => fb.firestore.FieldValue.serverTimestamp();
    let lastError = null;
    for (const shift of ATTEMPT_SHIFTS_MS) {
      let cfg, st;
      try { cfg = await config(db); st = await readState(db); }
      catch (e) { return fail('network'); }
      const v = view(cfg, st, nowFn());
      if (v.blocked) return fail(v.blocked, v);

      const volunteerRef = db.collection('volunteers').doc();
      const batch = db.batch();
      batch.set(stateRef(db), nextState(st, nowFn() + shift, volunteerRef.id, serverTs()));
      batch.set(volunteerRef, {
        nom: person.nom, prenom: person.prenom, network: 'bike', agreementAccepted: true, createdAt: serverTs()
      });
      try {
        await batch.commit();
        return { ok: true };
      } catch (e) {
        lastError = e;
        if (!e || e.code !== 'permission-denied') return fail(e && (e.code === 'unavailable' || e.code === 'deadline-exceeded' || !e.code) ? 'network' : 'unknown');
      }
    }
    // Refused every time: explain with the counters as they are now
    try {
      const v = view(await config(db), await readState(db), nowFn());
      return fail(v.blocked || 'unknown', v);
    } catch (e) { return fail('unknown'); }

    function fail(reason, v) { return { ok: false, reason, message: message(reason, v), view: v || null, error: lastError }; }
  }

  // ---- administration (rules: an admin who works in bike) ----

  /** Validates the form values; returns { ok, values, errors } (errors: field -> text). */
  function parseConfig(input) {
    const values = {}, errors = {};
    [['perMinute', 'par minute'], ['perHour', 'par heure'], ['perDay', 'par jour'], ['total', 'au total']].forEach(([key, label]) => {
      const n = Number(input[key]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) errors[key] = `Limite ${label} : un nombre entier de 1 à ${MAX_LIMIT}.`;
      else values[key] = n;
    });
    values.enabled = input.enabled !== false;
    return { ok: Object.keys(errors).length === 0, values, errors };
  }

  async function saveConfig(db, fb, input) {
    const parsed = parseConfig(input);
    if (!parsed.ok) return parsed;
    await configRef(db).set({ ...parsed.values, updatedAt: fb.firestore.FieldValue.serverTimestamp() });
    return parsed;
  }

  /** All counters back to zero (new season, or after an incident). The limits themselves are kept. */
  async function reset(db, fb) {
    const ts = fb.firestore.FieldValue.serverTimestamp();
    await stateRef(db).set({
      total: 0, minuteStart: ts, minuteCount: 0, hourStart: ts, hourCount: 0, dayStart: ts, dayCount: 0,
      lastVolunteerId: '', updatedAt: ts
    });
  }

  return {
    DEFAULTS, WINDOWS, config, readState, view, nextState, message, check, register, parseConfig, saveConfig, reset,
    _setNow: fn => { nowFn = fn || (() => Date.now()); }
  };
})();
