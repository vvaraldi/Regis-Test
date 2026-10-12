/**
 * SupportMail - the e-mails of the Support app (new request, request taken in hand / resolved, new comment).
 *
 * The page does not send anything itself: it adds a small document to the Firestore collection "mail"; the Firebase
 * extension "Trigger Email from Firestore" (set up once in the console, with the client's SMTP account) sends it.
 *
 *   who gets what
 *     new request      -> the ONE admin chosen in the settings ("created_admin") + the person who made it ("created_creator")
 *     En cours/Résolu  -> the person who made the request (not when they changed it themselves)
 *     Archivé / Nouveau-> nothing
 *     new comment      -> by the creator: the chosen admin; by anyone else: the creator
 *
 * Settings: support_settings/config { enabled (false until an admin switches it on), adminUid }.
 * An e-mail never blocks what the person is doing: any failure is logged and the work goes on.
 * The Firestore rules (collection "mail") only let a signed-in user queue a short plain-text message to the request's
 * creator or to the chosen admin, so this cannot be used to send mail to anyone else.
 *
 *   SupportMail.notify(db, firebase, 'created' | 'status' | 'comment', { request, actor, status?, text?, url? })
 *
 * request: { id, title, type, priority, description, createdBy, createdByName }; actor: { uid, name }.
 */
const SupportMail = (() => {
  const SETTINGS = ['support_settings', 'config'];
  const TYPES = { bug: 'Bug', question: 'Question', suggestion: 'Suggestion' };
  const PRIORITIES = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };
  const KINDS = ['created_admin', 'created_creator', 'status', 'comment'];
  const cut = (s, n) => { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

  async function readSettings(db) {
    try {
      const snap = await db.collection(SETTINGS[0]).doc(SETTINGS[1]).get();
      const d = snap.exists ? snap.data() : {};
      return { enabled: d.enabled === true, adminUid: typeof d.adminUid === 'string' ? d.adminUid : '' };
    } catch (e) { return { enabled: false, adminUid: '' }; }
  }

  async function saveSettings(db, firebase, values, user) {
    const doc = {
      enabled: values.enabled === true,
      adminUid: values.adminUid || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.uid, updatedByName: user.name || ''
    };
    await db.collection(SETTINGS[0]).doc(SETTINGS[1]).set(doc, { merge: true });
    return doc;
  }

  /** Who should be written to, and what (pure: no database). Returns [{ uid, kind, subject, text }]. */
  function plan(event, ctx, settings) {
    const r = ctx.request || {}, actor = ctx.actor || {}, url = ctx.url || '';
    const title = cut(r.title, 120);
    const footer = url ? `\n\nOuvrir la demande : ${url}` : '';
    const out = [];
    const add = (uid, kind, subject, text) => { if (uid && !out.some(o => o.uid === uid)) out.push({ uid, kind, subject: cut(subject, 180), text: cut(text, 2800) }); };

    if (event === 'created') {
      const summary = `Titre : ${title}\nType : ${TYPES[r.type] || r.type || '-'}\nPriorité : ${PRIORITIES[r.priority] || r.priority || '-'}\n\n${cut(r.description, 600)}`;
      add(settings.adminUid, 'created_admin', `[Support] Nouvelle demande : ${title}`,
        `Bonjour,\n\n${r.createdByName || 'Un utilisateur'} a créé une nouvelle demande de support.\n\n${summary}${footer}`);
      add(r.createdBy, 'created_creator', `[Support] Votre demande a bien été reçue : ${title}`,
        `Bonjour,\n\nVotre demande a bien été reçue. Vous recevrez un courriel quand elle sera prise en charge ou résolue.\n\n${summary}${footer}`);
    } else if (event === 'status') {
      const words = { in_progress: ['en cours', 'est maintenant en cours de traitement'], resolved: ['résolue', 'a été résolue'] }[ctx.status];
      if (words && r.createdBy && r.createdBy !== actor.uid) {
        add(r.createdBy, 'status', `[Support] Votre demande est ${words[0]} : ${title}`,
          `Bonjour,\n\nVotre demande « ${title} » ${words[1]}.${footer}`);
      }
    } else if (event === 'comment') {
      const body = cut(ctx.text, 800);
      if (actor.uid && actor.uid === r.createdBy) {
        if (settings.adminUid && settings.adminUid !== actor.uid) {
          add(settings.adminUid, 'comment', `[Support] Nouveau commentaire de ${actor.name || 'l\'auteur'} : ${title}`,
            `${actor.name || 'L\'auteur de la demande'} a ajouté un commentaire à sa demande « ${title} » :\n\n${body}${footer}`);
        }
      } else if (r.createdBy) {
        add(r.createdBy, 'comment', `[Support] Nouveau commentaire sur votre demande : ${title}`,
          `${actor.name || 'Quelqu\'un'} a ajouté un commentaire à votre demande « ${title} » :\n\n${body}${footer}`);
      }
    }
    return out;
  }

  async function emailOf(db, uid, cache) {
    if (!(uid in cache)) {
      try { const snap = await db.collection('inspectors').doc(uid).get(); cache[uid] = snap.exists ? (snap.data().email || '') : ''; }
      catch (e) { cache[uid] = ''; }
    }
    return cache[uid];
  }

  /** Queues the e-mails of one event. Returns { sent, skipped, failed } and never throws. */
  async function notify(db, firebase, event, ctx) {
    const result = { sent: 0, skipped: 0, failed: 0 };
    try {
      const settings = ctx.settings || await readSettings(db);
      if (!settings.enabled) return result;
      const emails = {};
      for (const item of plan(event, ctx, settings)) {
        const to = await emailOf(db, item.uid, emails);
        if (!to) { result.skipped++; continue; }
        try {
          await db.collection('mail').add({
            to: [to],
            message: { subject: item.subject, text: item.text },
            requestId: ctx.request.id, kind: item.kind,
            createdBy: ctx.actor.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          result.sent++;
        } catch (e) { console.error('Support e-mail:', e); result.failed++; }
      }
    } catch (e) { console.error('Support e-mail:', e); result.failed++; }
    return result;
  }

  return { KINDS, readSettings, saveSettings, plan, notify };
})();
