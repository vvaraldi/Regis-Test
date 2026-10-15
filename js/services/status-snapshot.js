/**
 * StatusSnapshot - reads the PUBLIC status file: public/status.json in Cloud Storage, rewritten every minute or so by the Cloud
 * Function "publishStatus" (see PUBLIC_STATUS_SETUP.md). It holds the status of the trails and the latest weather reading, so a
 * public page (ours, or the Mont Orford web site) needs no Firestore at all: the number of visitors never changes what
 * Firestore is asked, or billed.
 *
 *   StatusSnapshot.url(bucket)                 the web address of the file (bucket: "trail-inspection.firebasestorage.app")
 *   StatusSnapshot.fetchSnapshot(bucket)       reads and revives it (rejects when the file cannot be read)
 *   StatusSnapshot.revive(json)                the file's JSON as { generatedAt (Date), refreshMinutes, network, trails, sectors, weather }:
 *                                              each trail has lastUpdated = { toDate() } like a Firestore timestamp, and
 *                                              weather is the object WeatherPublic.panelHtml() draws (or null)
 *   StatusSnapshot.isStale(snapshot, now)      true when the file has not been rewritten for much longer than it should
 *   StatusSnapshot.POLL_MS                     how often a page should read it again (the file is cached for a minute)
 *
 * This file stands alone (no other script needed) so another website can simply copy it.
 */
const StatusSnapshot = (() => {
  const POLL_MS = 60 * 1000;
  const MIN_STALE_MINUTES = 30;

  /** The address of the file. Cloud Storage's download address; the Storage rules make this one folder public. */
  function url(bucket) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/public%2Fstatus.json?alt=media`;
  }

  function revive(json) {
    if (!json || json.version !== 1 || !Array.isArray(json.trails)) return null;
    const generatedAt = new Date(json.generatedAt);
    return {
      generatedAt: isNaN(generatedAt) ? null : generatedAt,
      refreshMinutes: json.refreshMinutes || null,
      network: json.network || null,   // the activity in the file (only the season's activity is published)
      trails: json.trails.map(t => Object.assign({}, t, {
        lastUpdated: t.lastUpdated ? { toDate: () => new Date(t.lastUpdated), toMillis: () => t.lastUpdated } : null
      })),
      sectors: Array.isArray(json.sectors) ? json.sectors : [],   // { id, name, order, aliases }: the list page groups the trails by sector
      weather: json.weather || null
    };
  }

  const ageMinutes = (snapshot, now) => snapshot && snapshot.generatedAt ? ((now || new Date()).getTime() - snapshot.generatedAt.getTime()) / 60000 : Infinity;

  /** Stale: older than 3 refresh periods plus 5 minutes, and never less than 30 minutes (a short hiccup is not shown). */
  function isStale(snapshot, now) {
    const every = (snapshot && snapshot.refreshMinutes) || 10;
    return ageMinutes(snapshot, now) > Math.max(MIN_STALE_MINUTES, 3 * every + 5);
  }

  async function fetchSnapshot(bucket, fetchFn) {
    const res = await (fetchFn || ((...a) => window.fetch(...a)))(url(bucket));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const snapshot = revive(await res.json());
    if (!snapshot) throw new Error('Unreadable status file');
    return snapshot;
  }

  return { POLL_MS, url, revive, ageMinutes, isStale, fetchSnapshot };
})();
