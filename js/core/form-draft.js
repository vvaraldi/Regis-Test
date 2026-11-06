/**
 * form-draft.js - keeps an UNSENT report on the phone
 * =====================================================
 * On the mountain the signal comes and goes: a report filled in and not sent (no signal, a call, a battery, a reload) used to be lost.
 * A draft keeps what was typed and chosen, in this browser only, and offers it back the next time the report page opens.
 *
 *   const draft = FormDraft.attach(form, { uid, page: 'infraction-report', network: Network.current(), active: () => isNewReport });
 *   draft.offer();      // after the page's lists are loaded: shows "Brouillon retrouvé", with Reprendre / Supprimer
 *   draft.clear();      // after a successful save (a form 'reset' event clears it too)
 *   draft.kept();       // in the save's catch: tells the user the report is kept
 *   if (draft.offlineBlock()) return;   // top of the submit handler: no signal -> keep the draft, do not start a save that would hang
 *
 * What is kept: every text, number, date, list, tick box and choice of the form (found by id; radios by name + value). The date and
 * time of the report are kept as typed (an inspection made at 10:12 stays 10:12 when sent at 11:05).
 * NOT kept: photos (files cannot be stored this way: they are added again), the QR code of an infraction, anything the page keeps in
 * JavaScript instead of the form. A field a list no longer offers is skipped.
 *
 * Saving starts at the first thing the USER types or picks (a page that only fills defaults saves nothing), a moment after each
 * change, and at once when the page is hidden or closed. Only for a NEW report (`active`). One draft per user, page and activity;
 * dropped after 7 days; wiped on logout (auth.js empties the local storage). Nothing leaves the device.
 */
const FormDraft = (function () {
  'use strict';

  const PREFIX = 'regis-draft:';
  const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
  const SAVE_DELAY = 700;
  const WAIT_FIELD_MS = 2500;       // a list or a checklist filled by the page after an earlier choice: wait for it
  const SKIP_TYPES = ['file', 'password', 'button', 'submit', 'reset', 'hidden', 'image'];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tryDo = fn => { try { return fn(); } catch (e) { return undefined; } };
  const toast = (message, type, ms) => { if (typeof showToast === 'function') showToast(message, type, ms); };
  const keyOf = el => el.id || (el.name ? `${el.name}:${el.value}` : '');

  function fieldsOf(form) {
    return [...form.querySelectorAll('input, textarea, select')].filter(el =>
      !SKIP_TYPES.includes(el.type) && !el.readOnly && !el.disabled && el.dataset.noDraft === undefined && keyOf(el));
  }

  /** The values of the form: { key: text | true/false }, in the order of the page. */
  function read(form) {
    const values = {};
    fieldsOf(form).forEach(el => { values[keyOf(el)] = (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked : el.value; });
    return values;
  }

  function find(form, key) {
    const byId = [...form.querySelectorAll('[id]')].find(el => el.id === key);
    if (byId) return byId;
    const i = key.indexOf(':');
    if (i < 0) return null;
    const name = key.slice(0, i), value = key.slice(i + 1);
    return [...form.querySelectorAll('input')].find(el => el.name === name && el.value === value) || null;
  }

  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const whenText = ts => new Date(ts).toLocaleString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const clockText = ts => new Date(ts).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

  function attach(form, options) {
    const opts = options || {};
    if (!form || !opts.uid || !opts.page) throw new Error('FormDraft.attach needs a form, a uid and a page');
    const storeKey = `${PREFIX}${opts.uid}:${opts.page}:${opts.network || ''}`;
    let dirty = false, timer = null, restoring = false, banner = null, note = null;
    const active = () => (opts.active ? !!opts.active() : true);

    const stored = () => {
      const raw = tryDo(() => localStorage.getItem(storeKey));
      if (!raw) return null;
      const d = tryDo(() => JSON.parse(raw));
      const fresh = d && d.v === 1 && d.values && typeof d.values === 'object' && Object.keys(d.values).length && (Date.now() - d.savedAt) <= MAX_AGE_MS;
      if (!fresh) { tryDo(() => localStorage.removeItem(storeKey)); return null; }
      return d;
    };

    function showNote(ts) {
      if (!note) {
        note = document.createElement('div');
        note.className = 'form-draft-note';
        note.setAttribute('aria-live', 'polite');
        note.style.cssText = 'margin: 0.5rem 1rem; font-size: 0.8125rem; color: var(--theme-text-secondary, #5b6b73);';
        const footer = form.querySelector('.section-card__footer, .form-actions, .form-footer');
        if (footer) footer.insertAdjacentElement('beforebegin', note); else form.appendChild(note);
      }
      note.textContent = `Brouillon enregistré sur ce téléphone à ${clockText(ts)}`;
    }

    function save() {
      timer = null;
      if (!dirty || restoring || !active()) return;
      const payload = { v: 1, savedAt: Date.now(), values: read(form) };
      const ok = tryDo(() => { localStorage.setItem(storeKey, JSON.stringify(payload)); return true; });
      if (ok) showNote(payload.savedAt);
    }

    const flush = () => { if (timer) { clearTimeout(timer); save(); } };

    // only what the user does starts a draft (a script setting a default value is not "trusted")
    const schedule = event => {
      if (event && !event.isTrusted) return;
      if (restoring || !active()) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY);
    };
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
    form.addEventListener('reset', () => api.clear());   // "Réinitialiser", or the reset after a successful save

    function removeBanner() { if (banner) { banner.remove(); banner = null; } }

    async function restore(values) {
      restoring = true;
      let skipped = 0, patience = WAIT_FIELD_MS;
      try {
        for (const key of Object.keys(values)) {
          const wanted = values[key];
          const el = await waitFor(() => {
            const e = find(form, key);
            if (!e) return null;
            // a list may be filled by the page after an earlier choice: wait for the option (a blank choice needs no option: nothing to wait for)
            if (e.tagName === 'SELECT' && wanted !== '' && !tryDo(() => [...e.options].some(o => o.value === wanted))) return null;
            return e;
          }, patience);
          if (!el) { skipped++; patience = 300; continue; }   // after a miss, what depends on it will miss too: do not wait long again
          if (el.tagName === 'SELECT' && wanted === '' && !tryDo(() => [...el.options].some(o => o.value === ''))) continue;   // an empty list: nothing to put back
          if (el.type === 'checkbox' || el.type === 'radio') {
            if (el.checked !== !!wanted) { el.checked = !!wanted; fire(el, 'change'); }
          } else if (el.value !== wanted) {   // already the saved value: touch nothing (a change event on a blank list would make the page empty the lists that depend on it)
            el.value = wanted;
            fire(el, 'input'); fire(el, 'change');   // the page fills its dependent lists (trails of a sector, issues of a trail) from these
          }
          await sleep(40);
        }
      } finally {
        restoring = false;
      }
      dirty = true;
      save();
      return skipped;
    }

    async function waitFor(getter, patience) {
      const start = Date.now();
      for (;;) {
        const found = getter();
        if (found) return found;
        if (Date.now() - start > patience) return null;
        await sleep(80);
      }
    }

    const api = {
      /** The saved draft (or null): { savedAt, values }. */
      pending: stored,

      /** Shows "Brouillon retrouvé" above the form when there is one for this user, page and activity. Returns true when shown. */
      offer() {
        if (!active()) return false;
        const d = stored();
        removeBanner();
        if (!d) return false;
        banner = document.createElement('div');
        banner.className = 'form-draft-banner';
        banner.setAttribute('role', 'status');
        banner.style.cssText = 'margin: 0 0 1rem; padding: 0.75rem 1rem; border: 1px solid var(--theme-accent, #1b4b72); border-radius: 8px; background: rgba(27, 75, 114, 0.08); display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center;';
        const text = document.createElement('span');
        text.style.cssText = 'flex: 1 1 14rem;';
        text.textContent = `Brouillon retrouvé (enregistré le ${whenText(d.savedAt)}). Les photos ne sont pas gardées : il faudra les ajouter de nouveau.`;
        const resume = document.createElement('button');
        resume.type = 'button'; resume.className = 'btn btn-primary btn-sm'; resume.textContent = 'Reprendre le brouillon';
        const drop = document.createElement('button');
        drop.type = 'button'; drop.className = 'btn btn-secondary btn-sm'; drop.textContent = 'Supprimer';
        resume.addEventListener('click', async () => {
          resume.disabled = drop.disabled = true;
          const skipped = await restore(d.values);
          removeBanner();
          toast(skipped ? 'Brouillon repris. Vérifiez les champs : certains n’ont pas pu être remis.' : 'Brouillon repris. Pensez à ajouter les photos.', skipped ? 'warning' : 'info', 6000);
        });
        drop.addEventListener('click', () => { api.clear(); });
        banner.append(text, resume, drop);
        form.insertAdjacentElement('afterbegin', banner);
        return true;
      },

      /** Count a change as the user's (for a control the page draws itself, and for the tests: a script cannot make a trusted event). */
      touch() { schedule(); },

      /** Forget the draft (the report was sent, or the user starts again). */
      clear() {
        clearTimeout(timer); timer = null; dirty = false;
        tryDo(() => localStorage.removeItem(storeKey));
        removeBanner();
        if (note) { note.remove(); note = null; }
      },

      /** For the catch of the save: the report was not sent, say that it is kept. */
      kept() {
        flush();
        if (!tryDo(() => localStorage.getItem(storeKey))) return false;
        toast('Votre rapport est conservé sur ce téléphone (brouillon). Réessayez dès que la connexion revient.', 'warning', 9000);
        return true;
      },

      /** Top of the submit handler: with no signal at all, keep the draft and do not start a save that would hang. Returns true when blocked. */
      offlineBlock() {
        if (typeof navigator === 'undefined' || navigator.onLine !== false) return false;
        flush();
        toast('Pas de connexion : votre rapport est conservé sur ce téléphone. Réessayez quand le réseau revient.', 'warning', 9000);
        return true;
      },

      storageKey: storeKey
    };
    return api;
  }

  /** Every draft of this browser (tests, or a "forget everything" action). */
  function clearAll() {
    tryDo(() => Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k)));
  }

  return { attach, clearAll, PREFIX, MAX_AGE_MS };
})();
if (typeof window !== 'undefined') window.FormDraft = FormDraft;
