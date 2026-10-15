/**
 * StatusService - the open / closed status of the trails and lifts, and the recommendations that inspections leave.
 * =================================================================================================================
 * The status is changed by a person who decides, never by an inspection:
 *   - the mountain manager in "Régis gère" (one trail, a whole sector, the whole mountain),
 *   - the Météo person, lifts only (Météo > Remontées).
 * An inspection only leaves a RECOMMENDATION on the trail (trails/{id}.recommendation); the manager accepts it (by
 * switching the status) or ignores it (the arrow). Every change goes through change() / ignore() below, which write the
 * trail AND a line of the status log (collection `status_log`, never edited, never deleted) in the same batch.
 *
 * trails/{id}.recommendation  null, or { status: 'open'|'closed', inspectionId, at, condition, issueCount }
 *                             - always the OPPOSITE of the trail's status (an inspection that agrees with the status
 *                             clears it); a newer inspection replaces an older recommendation.
 *
 * status_log/{id}
 *   network, trailId, trailName, trailNumber, kind, sector, sectorName   what was changed
 *   action       'status' (the status was switched) | 'ignore' (a recommendation was dismissed, the status stays)
 *   from, to     the status before and after ('open' | 'closed' | 'unknown')
 *   mode         how: 'individual' | 'sector' | 'mountain'      scope: the sector's name for 'sector', else null
 *   app          which app: 'regis' (Régis gère) | 'meteo' (Météo)
 *   byUid, byName, at                                           who and when (server time)
 *   reason       free text (empty for now: the screens do not ask for one yet)
 *   recommended  the status an inspection had recommended at that time, or null
 *   decision     'accepted' | 'ignored' | null                  what was done with that recommendation
 *   inspectionId the inspection that made it, or null
 *   batchId      shared by all lines of one sector / mountain action
 *
 * Needs the `db` and `firebase` objects of the page (same style as WeatherService).
 */
const StatusService = (() => {
  const LOG = 'status_log';
  const CHUNK = 200;   // two writes per trail (the trail and its log line): well under the 500 of a batch

  const statusOf = trail => (trail && (trail.status === 'open' || trail.status === 'closed')) ? trail.status : 'unknown';

  /** The pending recommendation of a trail, or null */
  function recommendationOf(trail) {
    const r = trail && trail.recommendation;
    return r && (r.status === 'open' || r.status === 'closed') && r.status !== statusOf(trail) ? r : null;
  }

  /**
   * What an inspection leaves on the trail: null when it agrees with the current status (that also clears an older
   * recommendation), otherwise the recommendation. info: { inspectionId, condition, issueCount }.
   */
  function recommendationFrom(currentStatus, chosen, info, fb) {
    if (chosen !== 'open' && chosen !== 'closed') return null;
    if (chosen === currentStatus) return null;
    const i = info || {};
    return {
      status: chosen,
      inspectionId: i.inspectionId || null,
      at: fb.firestore.FieldValue.serverTimestamp(),
      condition: i.condition || null,
      issueCount: Number.isFinite(i.issueCount) ? i.issueCount : 0
    };
  }

  function logLine(trail, fields, ctx, fb, batchId) {
    const rec = recommendationOf(trail);
    return Object.assign({
      network: trail.network || ctx.network || null,
      trailId: trail.id,
      trailName: trail.name || trail.id,
      trailNumber: trail.number === undefined ? null : trail.number,
      kind: trail.kind || null,
      sector: trail.sector || null,
      sectorName: (ctx.sectorNames && ctx.sectorNames[trail.sector]) || null,
      mode: ctx.mode || 'individual',
      scope: ctx.scope || null,
      app: ctx.app,
      byUid: ctx.user.uid,
      byName: ctx.user.name || '',
      at: fb.firestore.FieldValue.serverTimestamp(),
      reason: String(ctx.reason || '').trim().slice(0, 500),
      recommended: rec ? rec.status : null,
      inspectionId: rec ? (rec.inspectionId || null) : null,
      batchId: batchId || null
    }, fields);
  }

  /**
   * Switches trails to `status` ('open' | 'closed'). Only the trails whose status is different are written.
   * ctx: { user: {uid, name}, app: 'regis'|'meteo', mode, scope, reason, sectorNames: {sectorId: name} }.
   * A recommendation that says the new status is accepted (and removed from the trail). Returns { changed, skipped }.
   */
  async function change(db, fb, trails, status, ctx) {
    if (status !== 'open' && status !== 'closed') throw new Error('Statut invalide.');
    const todo = trails.filter(t => statusOf(t) !== status);
    const batchId = todo.length > 1 ? db.collection(LOG).doc().id : null;
    for (let i = 0; i < todo.length; i += CHUNK) {
      const batch = db.batch();
      todo.slice(i, i + CHUNK).forEach(t => {
        const rec = recommendationOf(t);
        const patch = { status, lastUpdated: fb.firestore.FieldValue.serverTimestamp() };
        if (t.recommendation && (!rec || rec.status === status)) patch.recommendation = null;   // accepted (or stale)
        batch.update(db.collection('trails').doc(t.id), patch);
        batch.set(db.collection(LOG).doc(), logLine(t, { action: 'status', from: statusOf(t), to: status, decision: rec && rec.status === status ? 'accepted' : null }, ctx, fb, batchId));
      });
      await batch.commit();
    }
    return { changed: todo.length, skipped: trails.length - todo.length };
  }

  /** Dismisses the recommendation of a trail (the status stays); the line of the log says it was ignored. */
  async function ignore(db, fb, trail, ctx) {
    const rec = recommendationOf(trail);
    if (!rec) return { changed: 0 };
    const batch = db.batch();
    batch.update(db.collection('trails').doc(trail.id), { recommendation: null });
    batch.set(db.collection(LOG).doc(), logLine(trail, { action: 'ignore', from: statusOf(trail), to: statusOf(trail), decision: 'ignored' }, Object.assign({}, ctx, { mode: 'individual', scope: null }), fb, null));
    await batch.commit();
    return { changed: 1 };
  }

  return { LOG, statusOf, recommendationOf, recommendationFrom, change, ignore };
})();
if (typeof window !== 'undefined') window.StatusService = StatusService;
