/**
 * LiveListener - a Firestore live listener that does not run for nothing.
 * ======================================================================
 * A listener (query.onSnapshot) is billed once for what it reads at the start, then once per document that changes: cheap, and the page
 * updates by itself. Left open on a screen nobody looks at it would still be billed for every change, so this helper:
 *   - detaches the listener when the tab has been HIDDEN for 5 minutes (default),
 *   - attaches it again when the tab is shown (the first answer then holds the whole data, so the page can compare it with what it had
 *     and say what changed meanwhile),
 *   - tells the page when the listener fails (rules, network) so it can say the live update stopped; it is tried again when the tab is
 *     shown again.
 *
 *   const live = LiveListener.watch(() => db.collection('trails').where(...), (snapshot, info) => { ... }, (error) => { ... }, { hiddenMs, onState });
 *   info = { first: true for the first answer of an attachment, reattached: true when it is not the first attachment }
 *   live.isLive()  live.stop()   (onState('live' | 'paused' | 'error') tells the page what the state is)
 *
 * Needs nothing else (plain browser APIs).
 */
const LiveListener = (function () {
  'use strict';
  const HIDDEN_MS = 5 * 60 * 1000;

  function watch(makeQuery, onSnapshot, onError, options) {
    const o = options || {};
    const hiddenMs = Number.isFinite(o.hiddenMs) ? o.hiddenMs : HIDDEN_MS;
    let unsubscribe = null, timer = null, stopped = false, attachments = 0, firstOfAttachment = false;
    const state = s => { if (o.onState) o.onState(s); };

    function attach() {
      if (unsubscribe || stopped) return;
      attachments++; firstOfAttachment = true;
      const reattached = attachments > 1;
      try {
        unsubscribe = makeQuery().onSnapshot(snapshot => {
          const info = { first: firstOfAttachment, reattached };
          firstOfAttachment = false;
          state('live');
          onSnapshot(snapshot, info);
        }, error => {
          unsubscribe = null;   // a failed listener is over: tried again when the tab is shown again
          state('error');
          if (onError) onError(error);
        });
      } catch (error) { unsubscribe = null; state('error'); if (onError) onError(error); }
    }
    function detach() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      state('paused');
    }
    function onVisibility() {
      if (stopped) return;
      clearTimeout(timer);
      if (document.hidden) timer = setTimeout(() => { if (document.hidden) detach(); }, hiddenMs);
      else if (!unsubscribe) attach();
    }

    document.addEventListener('visibilitychange', onVisibility);
    attach();
    return {
      isLive: () => !!unsubscribe,
      stop() { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); if (unsubscribe) { unsubscribe(); unsubscribe = null; } }
    };
  }

  return { watch, HIDDEN_MS };
})();
if (typeof window !== 'undefined') window.LiveListener = LiveListener;
