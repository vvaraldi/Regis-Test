/**
 * PublicStatusAdmin - the "Statut public" tab of Administration (system admin only): the schedule of the Cloud Function
 * "publishStatus", which rewrites the public file public/status.json (trail status + latest weather) that the public pages read.
 *
 * The settings live in the document public_status/config (rules: only the system admin reads and writes it):
 *   enabled (pause / resume), dayFrom / dayTo (Eastern time), dayEveryMinutes, nightEveryMinutes, refreshRequestedAt
 * The function writes back the report of its last run: lastRunAt, lastPublishedAt, lastResult, lastError, trailCount, bytes.
 *
 * Requires: firebase (db), status-snapshot.js (the file's address), APP_CONFIG; the markup is the #publication-tab of user-management.html.
 */
const PublicStatusAdmin = (() => {
  const DEFAULTS = { enabled: true, dayFrom: '06:00', dayTo: '18:00', dayEveryMinutes: 1, nightEveryMinutes: 10 };
  const FREE_READS_PER_DAY = 50000;      // Firestore's free quota (the page linked below says it)
  const WAKEUPS_PER_DAY = 1440;          // the function wakes up every minute and reads its settings: 1 read each time
  const MONTH_DAYS = 30;
  const PRICE_PER_100K_READS = 0.06;     // US dollars, indicative (Firestore pricing page, multi-region): only to give an order of magnitude
  const QUOTA_URL = 'https://firebase.google.com/docs/firestore/quotas#free-quota';
  const PRICING_URL = 'https://firebase.google.com/docs/firestore/pricing';

  const minutesOf = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const isTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '');
  const el = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString('fr-CA');
  const money = n => n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';

  /** What a schedule costs in refreshes and in Firestore reads (pure: the tests call it too). trailCount: the trails of the last file. */
  function estimate(settings, trailCount) {
    const s = Object.assign({}, DEFAULTS, settings);
    const dayMinutes = minutesOf(s.dayTo) - minutesOf(s.dayFrom);
    const nightMinutes = 1440 - dayMinutes;
    const dayRuns = dayMinutes / s.dayEveryMinutes;
    const nightRuns = nightMinutes / s.nightEveryMinutes;
    const perDay = Math.round(dayRuns + nightRuns);
    const readsPerRefresh = (trailCount || 96) + 1;                 // every trail, plus the weather document
    const readsPerDay = perDay * readsPerRefresh + WAKEUPS_PER_DAY;
    const extraReadsPerDay = Math.max(0, readsPerDay - FREE_READS_PER_DAY);
    return {
      dayRuns: Math.round(dayRuns), nightRuns: Math.round(nightRuns), perDay, perMonth: perDay * MONTH_DAYS,
      readsPerRefresh, readsPerDay, readsPerMonth: readsPerDay * MONTH_DAYS,
      freeReadsPerDay: FREE_READS_PER_DAY, extraReadsPerDay,
      costPerMonth: extraReadsPerDay * MONTH_DAYS / 100000 * PRICE_PER_100K_READS
    };
  }

  let ref = null, user = null, current = null, started = false;

  const formValues = () => ({
    dayFrom: el('ps-day-from').value, dayTo: el('ps-day-to').value,
    dayEveryMinutes: parseInt(el('ps-day-every').value, 10), nightEveryMinutes: parseInt(el('ps-night-every').value, 10)
  });

  /** Why the form cannot be saved, or null. */
  function problem(v) {
    if (!isTime(v.dayFrom) || !isTime(v.dayTo)) return 'Indiquez les heures de début et de fin du jour.';
    if (minutesOf(v.dayFrom) >= minutesOf(v.dayTo)) return 'L\'heure de fin du jour doit être après l\'heure de début.';
    const bad = n => !Number.isInteger(n) || n < 1 || n > 60;
    if (bad(v.dayEveryMinutes) || bad(v.nightEveryMinutes)) return 'Les intervalles sont de 1 à 60 minutes.';
    return null;
  }

  function renderEstimate() {
    const v = formValues();
    const box = el('ps-estimate');
    if (problem(v)) { box.hidden = true; return; }
    box.hidden = false;
    const e = estimate(v, current && current.trailCount);
    el('ps-est-day-runs').textContent = fmt(e.dayRuns);
    el('ps-est-night-runs').textContent = fmt(e.nightRuns);
    el('ps-est-per-day').textContent = fmt(e.perDay);
    el('ps-est-per-month').textContent = fmt(e.perMonth);
    el('ps-est-reads-refresh').textContent = fmt(e.readsPerRefresh);
    el('ps-est-reads-day').textContent = fmt(e.readsPerDay);
    el('ps-est-free').textContent = fmt(e.freeReadsPerDay);
    el('ps-est-extra').textContent = e.extraReadsPerDay ? fmt(e.extraReadsPerDay) : '0';
    el('ps-est-cost').textContent = e.extraReadsPerDay ? '≈ ' + money(e.costPerMonth) : '0,00 $ (sous le quota gratuit)';
  }

  const when = ts => {
    const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts ? new Date(ts) : null);
    return d && !isNaN(d) ? d.toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
  };

  function renderState(data) {
    current = data;
    const s = Object.assign({}, DEFAULTS, data || {});
    const paused = s.enabled === false;
    const badge = el('ps-state');
    badge.textContent = paused ? '⏸ En pause' : '▶ En marche';
    badge.className = 'badge ' + (paused ? 'badge-warning' : 'badge-success');
    el('ps-toggle-btn').textContent = paused ? '▶ Reprendre' : '⏸ Mettre en pause';
    el('ps-pause-note').hidden = !paused;
    el('ps-last').textContent = data && data.lastRunAt ? when(data.lastRunAt) : 'Pas encore (la fonction n\'a pas encore tourné)';
    el('ps-published').textContent = data && data.lastPublishedAt ? when(data.lastPublishedAt) : '—';
    el('ps-count').textContent = data && data.trailCount != null ? `${data.trailCount} sentier(s), ${Math.round((data.bytes || 0) / 1024 * 10) / 10} Ko` : '—';
    const failed = data && data.lastResult === 'error';
    el('ps-error').hidden = !failed;
    el('ps-error').textContent = failed ? 'Dernière tentative en erreur : ' + (data.lastError || '') : '';
    // the form shows the saved values, unless it is being edited
    if (!el('ps-form').dataset.dirty) {
      el('ps-day-from').value = s.dayFrom; el('ps-day-to').value = s.dayTo;
      el('ps-day-every').value = s.dayEveryMinutes; el('ps-night-every').value = s.nightEveryMinutes;
    }
    renderEstimate();
  }

  async function write(fields, okMessage) {
    try {
      await ref.set(Object.assign({ updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: user }, fields), { merge: true });
      if (okMessage && typeof showToast === 'function') showToast(okMessage, 'success');
      return true;
    } catch (e) {
      console.error('Public status settings:', e);
      if (typeof showToast === 'function') showToast('Impossible d\'enregistrer (droits ou connexion).', 'error');
      return false;
    }
  }

  async function togglePause() {
    const paused = current && current.enabled === false;
    await write({ enabled: paused ? true : false }, paused ? 'Mise à jour du statut public reprise.' : 'Mise à jour du statut public en pause : la page publique garde les dernières données.');
  }

  async function refreshNow() {
    const ok = await write({ refreshRequestedAt: firebase.firestore.FieldValue.serverTimestamp() });
    if (ok && typeof showToast === 'function') showToast('Rafraîchissement demandé : le fichier est réécrit dans la minute qui suit.', 'success');
  }

  async function save(event) {
    if (event) event.preventDefault();
    const v = formValues();
    const why = problem(v);
    el('ps-form-error').textContent = why || '';
    el('ps-form-error').hidden = !why;
    if (why) return;
    if (await write(v, 'Horaire enregistré : il s\'applique dès la prochaine minute.')) delete el('ps-form').dataset.dirty;
  }

  function init(userId) {
    if (started) return;
    started = true;
    user = userId || null;
    ref = window.db.collection('public_status').doc('config');
    el('ps-quota-link').href = QUOTA_URL;
    el('ps-pricing-link').href = PRICING_URL;
    const bucket = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.firebase && APP_CONFIG.firebase.storageBucket) || '';
    const link = el('ps-file-link');
    link.href = typeof StatusSnapshot !== 'undefined' ? StatusSnapshot.url(bucket) : '#';
    el('ps-toggle-btn').addEventListener('click', togglePause);
    el('ps-now-btn').addEventListener('click', refreshNow);
    el('ps-form').addEventListener('submit', save);
    ['ps-day-from', 'ps-day-to', 'ps-day-every', 'ps-night-every'].forEach(id => el(id).addEventListener('input', () => { el('ps-form').dataset.dirty = '1'; renderEstimate(); }));
    // the report of the last run comes by itself (a listener on one small document)
    ref.onSnapshot(snap => renderState(snap.exists ? snap.data() : null), error => {
      console.error('Public status settings:', error);
      el('ps-error').hidden = false;
      el('ps-error').textContent = 'Les réglages ne peuvent pas être lus (règles de sécurité non publiées ?).';
    });
  }

  return { init, estimate, problem, DEFAULTS, QUOTA_URL, PRICING_URL };
})();
