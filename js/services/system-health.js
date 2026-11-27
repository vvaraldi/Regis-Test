/**
 * SystemHealth - "is everything working?" for the system admin: the tab Administration > Santé and the dot on the Administration tile.
 * ===================================================================================================================================
 *   SystemHealth.read(db, options)        reads what is needed (4 or 5 documents) -> the input of evaluate(); a read that fails is noted
 *   SystemHealth.evaluate(input, now)     -> { cards: [{ id, title, state, headline, lines, link }], summary: { state, text } }
 * state: 'ok' (green) | 'warn' (orange, to watch) | 'bad' (red, to fix) | 'none' (grey: nothing to judge)
 *
 * The checks, and their limits (agreed 2026-11-26):
 *   backup   system_status/backup (written by the function backupData): red when the last run failed, or no success for more than 26 hours
 *   public   public_status/config (written by publishStatus): red when it failed, or the file is older than 30 minutes (more when the
 *            schedule itself is slower: twice its longest interval + 5); orange when paused or never published
 *   mail     system_status/mail (written by sendMail): orange when an e-mail failed in the last 7 days, red when the last 3 all failed
 *   weather  the latest weather reading: orange when older than 24 hours, in the ski season only
 *   quota    no figure yet: a link to Google's usage page
 * The training site has no backup and sends no e-mail: those two cards are left out there (options.training).
 * A panel only shows a problem to someone who opens it: the e-mail alerts of Google Cloud (backup, publishStatus) remain the alarm.
 */
const SystemHealth = (() => {
  'use strict';
  const BACKUP_MAX_HOURS = 26;
  const PUBLIC_MIN_MINUTES = 30;
  const MAIL_RECENT_DAYS = 7;
  const MAIL_BAD_IN_A_ROW = 3;
  const WEATHER_MAX_HOURS = 24;

  const ms = t => !t ? 0 : typeof t.toMillis === 'function' ? t.toMillis() : typeof t.toDate === 'function' ? t.toDate().getTime() : (t instanceof Date ? t.getTime() : (Number(t) || 0));
  const plural = (n, word, many) => `${n} ${n > 1 ? (many || word + 's') : word}`;
  const nf = n => Math.round(n).toLocaleString('fr-CA');
  const size = bytes => !(bytes > 0) ? '' : bytes < 1048576 ? `${nf(Math.max(1, bytes / 1024))} Ko` : `${(bytes / 1048576).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} Mo`;
  const when = t => new Date(ms(t)).toLocaleString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /** "il y a 3 min", "il y a 5 h", "il y a 4 jours" */
  function ago(t, now) {
    const minutes = Math.max(0, Math.round((now.getTime() - ms(t)) / 60000));
    if (minutes < 1) return 'à l’instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    if (minutes < 48 * 60) return `il y a ${Math.floor(minutes / 60)} h`;
    return `il y a ${Math.floor(minutes / 1440)} jours`;
  }

  const card = (id, title, state, headline, lines, link) => ({ id, title, state, headline, lines: (lines || []).filter(Boolean), link: link || null });
  const unreadable = (id, title) => card(id, title, 'warn', 'Lecture impossible', ['Republiez les règles de sécurité (assets/Rules for Firebase.txt), puis actualisez.']);

  function backupCard(doc, now) {
    const title = 'Sauvegarde de nuit';
    if (!doc || !doc.lastRunAt) return card('backup', title, 'none', 'Aucun résultat', ['Il apparaît après le prochain passage (3 h 30), une fois la fonction de sauvegarde redéployée.']);
    const lines = [doc.lastSuccessAt ? `Dernière réussite : ${when(doc.lastSuccessAt)}` : 'Aucune réussite enregistrée', doc.docs ? `${nf(doc.docs)} documents · ${size(doc.bytes)}` : '', Number.isFinite(doc.kept) ? `${plural(doc.kept, 'fichier conservé', 'fichiers conservés')}` : ''];
    if (doc.lastOk === false) return card('backup', title, 'bad', 'Dernier passage en échec', [doc.lastError || ''].concat(lines));
    const hours = doc.lastSuccessAt ? (now.getTime() - ms(doc.lastSuccessAt)) / 3600000 : Infinity;
    if (hours > BACKUP_MAX_HOURS) return card('backup', title, 'bad', doc.lastSuccessAt ? `Aucune depuis ${ago(doc.lastSuccessAt, now).replace('il y a ', '')}` : 'Aucune sauvegarde', lines);
    return card('backup', title, 'ok', ago(doc.lastSuccessAt, now), lines);
  }

  function publicCard(doc, now) {
    const title = 'Page publique';
    const d = doc || {};
    const day = Number(d.dayEveryMinutes) || 1, night = Number(d.nightEveryMinutes) || 10;
    const lines = [d.trailCount ? `${nf(d.trailCount)} sentiers publiés · ${size(d.bytes)}` : '', `Rafraîchie toutes les ${day} min le jour, ${night} min le reste du temps`];
    if (d.lastResult === 'error') return card('public', title, 'bad', 'Publication en échec', [d.lastError || '', d.lastPublishedAt ? `Dernière réussite : ${when(d.lastPublishedAt)}` : ''].concat(lines));
    if (d.enabled === false) return card('public', title, 'warn', 'En pause', [d.lastPublishedAt ? `Dernière publication : ${when(d.lastPublishedAt)}` : '', 'Administration > Statut public pour reprendre.']);
    if (!d.lastPublishedAt) return card('public', title, 'warn', 'Jamais publiée', ['La fonction publishStatus n’a encore rien écrit.']);
    const minutes = (now.getTime() - ms(d.lastPublishedAt)) / 60000;
    if (minutes > Math.max(PUBLIC_MIN_MINUTES, 2 * Math.max(day, night) + 5)) return card('public', title, 'bad', ago(d.lastPublishedAt, now), ['Le fichier public n’est plus mis à jour.'].concat(lines));
    return card('public', title, 'ok', ago(d.lastPublishedAt, now), lines);
  }

  function mailCard(doc, enabled, now) {
    const title = 'Courriels du support';
    if (enabled === false) return card('mail', title, 'none', 'Désactivés', ['Support > bas de page > Courriels du support.']);
    const events = ((doc && doc.events) || []).slice().sort((a, b) => ms(a.at) - ms(b.at));
    if (!events.length) return card('mail', title, 'none', 'Aucun envoi enregistré', ['Les envois sont comptés une fois la fonction des courriels redéployée.']);
    const sent = events.filter(e => e.ok).length, failed = events.filter(e => !e.ok);
    const recent = failed.filter(e => now.getTime() - ms(e.at) <= MAIL_RECENT_DAYS * 86400000);
    const lastFail = failed[failed.length - 1];
    const lines = [`${plural(sent, 'envoyé')} et ${plural(failed.length, 'échec')} sur 30 jours`, lastFail ? `Dernier échec le ${when(lastFail.at)} : ${lastFail.error || 'raison inconnue'}` : ''];
    const tail = events.slice(-MAIL_BAD_IN_A_ROW);
    if (tail.length === MAIL_BAD_IN_A_ROW && tail.every(e => !e.ok)) return card('mail', title, 'bad', 'Les courriels ne partent plus', lines);
    if (recent.length) return card('mail', title, 'warn', `${plural(recent.length, 'échec')} en 7 jours`, lines);
    return card('mail', title, 'ok', `Dernier envoi ${ago(events[events.length - 1].at, now)}`, lines);
  }

  function weatherCard(record, skiSeason, now) {
    const title = 'Relevé météo';
    const last = record && record.recordedAt ? `Dernier relevé : ${when(record.recordedAt)}` : '';
    if (!skiSeason) return card('weather', title, 'none', 'Hors saison', [last]);
    if (!last) return card('weather', title, 'warn', 'Aucun relevé', ['Remontées & Météo pour en saisir un.']);
    const hours = (now.getTime() - ms(record.recordedAt)) / 3600000;
    return card('weather', title, hours > WEATHER_MAX_HOURS ? 'warn' : 'ok', ago(record.recordedAt, now), [last, 'Orange après 24 h en saison de ski']);
  }

  const quotaCard = projectId => card('quota', 'Quota gratuit', 'none', 'Chez Google', ['Lectures et écritures de la base, jour par jour.'],
    projectId ? { href: `https://console.firebase.google.com/project/${projectId}/usage`, text: 'Voir l’utilisation' } : null);

  /** input: { backup, mail, publicStatus, mailEnabled, weather, skiSeason, training, projectId, errors: { backup: true, ... } } */
  function evaluate(input, now) {
    const i = input || {}, at = now || new Date(), errors = i.errors || {};
    const build = (id, title, make) => (errors[id] ? unreadable(id, title) : make());
    const cards = [];
    if (!i.training) cards.push(build('backup', 'Sauvegarde de nuit', () => backupCard(i.backup, at)));
    cards.push(build('public', 'Page publique', () => publicCard(i.publicStatus, at)));
    if (!i.training) cards.push(build('mail', 'Courriels du support', () => mailCard(i.mail, i.mailEnabled, at)));
    cards.push(build('weather', 'Relevé météo', () => weatherCard(i.weather, i.skiSeason !== false, at)));
    cards.push(quotaCard(i.projectId));
    return { cards, summary: summarize(cards) };
  }

  function summarize(cards) {
    const of = state => cards.filter(c => c.state === state);
    const bad = of('bad'), warn = of('warn');
    const names = list => list.map(c => c.title.toLowerCase()).join(', ');
    if (bad.length) return { state: 'bad', text: `${plural(bad.length, 'problème')} à corriger : ${names(bad)}${warn.length ? ` (et à surveiller : ${names(warn)})` : ''}` };
    if (warn.length) return { state: 'warn', text: `${plural(warn.length, 'point')} à surveiller : ${names(warn)}` };
    return { state: 'ok', text: 'Tout va bien' };
  }

  /** Reads the documents the checks need. options: { training, projectId, skiSeason }. Never throws: a failed read is noted in `errors`. */
  async function read(db, options) {
    const o = options || {};
    const errors = {};
    const doc = async (id, collection, name) => {
      try { const s = await db.collection(collection).doc(name).get(); return s.exists ? s.data() : null; }
      catch (e) { console.warn('Santé:', collection + '/' + name, e); errors[id] = true; return null; }
    };
    const latestWeather = async () => {
      try { const s = await db.collection('weather_records').orderBy('recordedAt', 'desc').limit(1).get(); const rows = s.docs.map(d => d.data()).sort((a, b) => ms(b.recordedAt) - ms(a.recordedAt)); return rows[0] || null; }
      catch (e) { console.warn('Santé: weather', e); errors.weather = true; return null; }
    };
    const [backup, publicStatus, mail, support, weather] = await Promise.all([
      o.training ? null : doc('backup', 'system_status', 'backup'),
      doc('public', 'public_status', 'config'),
      o.training ? null : doc('mail', 'system_status', 'mail'),
      o.training ? null : doc('mail', 'support_settings', 'config'),
      latestWeather()
    ]);
    return { backup, publicStatus, mail, mailEnabled: support ? support.enabled === true : false, weather, skiSeason: o.skiSeason !== false, training: !!o.training, projectId: o.projectId || null, errors };
  }

  return { read, evaluate, summarize, ago, BACKUP_MAX_HOURS, PUBLIC_MIN_MINUTES, WEATHER_MAX_HOURS };
})();
if (typeof window !== 'undefined') window.SystemHealth = SystemHealth;
