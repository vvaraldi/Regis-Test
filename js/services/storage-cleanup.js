/**
 * storage-cleanup.js - Orphan photo files: Firebase Storage files that no record points to
 * =========================================================================================
 * One tool for the four apps (Inspections, Infractions, Signalisations, Entretien), used by the
 * "Nettoyage des fichiers orphelins" section of each app's Admin page (a system admin only: the
 * Storage rules refuse the deletion to anybody else).
 *
 * How a file is judged
 *   - The records of the app are read (EVERY activity, EVERY season: a file is an orphan only if
 *     no record at all refers to it), and the storage path of each photo is taken from its URL.
 *   - The files of the app's Storage folders are listed.
 *   - A file whose PATH is not referenced is an orphan. Paths are compared, not full URLs: a URL
 *     carries an access token (and a bucket host) that differ when files were copied to another
 *     project, which made every real photo look like an orphan. Comparing paths needs no per-file
 *     network call either.
 *
 * Safeguards (deletion is irreversible)
 *   - Files younger than 2 hours are skipped: they may belong to a report being written right now.
 *   - If records point to photos but NO file is found in the folders at all (another bucket after a
 *     migration, another folder, listing impossible), nothing can be judged: the tool says so and
 *     shows which bucket the records point to versus the one the app uses - never "no orphans".
 *   - If not a single file matches a record, the analysis is "suspicious" (links and files do not
 *     belong together): deletion is refused. If more than half of the files are orphans, a second,
 *     stronger confirmation is asked.
 *   - A first step only lists; nothing is deleted until the second button and a confirmation.
 *
 * Requires: firebase (db, storage) via auth.js / firebase-loader.js, and photo-service.js.
 */
const StorageCleanup = (function () {
  'use strict';

  const MIN_AGE_MS = 2 * 60 * 60 * 1000;

  const photoUrls = data => PhotoService.urlsFrom(data);

  // What each app keeps in Storage, and where its records point to it
  const APPS = {
    inspection: {
      noun: 'des inspections',
      folders: ['inspections/trails', 'inspections/shelters'],
      collections: ['trail_inspections', 'shelter_inspections'],
      urls: photoUrls
    },
    infraction: {
      noun: 'des infractions (photos et images de codes QR)',
      folders: ['infractions'],
      collections: ['infractions'],
      urls: data => photoUrls(data).concat(data.offenderQRImageUrl ? [data.offenderQRImageUrl] : [])
    },
    signalisation: {
      noun: 'des signalisations',
      folders: ['signalisations'],
      collections: ['signalisations'],
      urls: photoUrls
    },
    maintenance: {
      noun: 'de l\'entretien (photos de chaque travail)',
      folders: ['maintenance'],
      collections: ['maintenance_logs'],
      urls: data => (data.entries || []).flatMap(entry => PhotoService.urlsFrom({ photos: entry.photos }))
    }
  };

  /** The object path of a Storage download URL ("infractions/u1/123_a.jpg"), or null. */
  function pathOfUrl(url) {
    if (typeof url !== 'string') return null;
    const match = url.match(/\/o\/([^?#]+)/);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch (e) { return null; }
  }

  /** The bucket a download URL points to (".../v0/b/<bucket>/o/..."), or null. */
  function bucketOfUrl(url) {
    const match = typeof url === 'string' ? url.match(/\/v0\/b\/([^/]+)\/o\//) : null;
    return match ? match[1] : null;
  }

  /** The bucket this app reads and writes (config.js firebase.storageBucket), or null when unknown. */
  function configuredBucket() {
    try { return (APP_CONFIG.firebase.storageBucket || '').replace(/^gs:\/\//, '') || null; } catch (e) { return null; }
  }

  /**
   * What a Storage error says, with the server's own answer when there is one (a bare "storage/unknown"
   * hides the real reason: HTTP status and payload tell, for instance, a missing bucket from a blocked request).
   */
  function describeError(error) {
    if (!error) return 'erreur inconnue';
    const parts = [error.code ? `[${error.code}]` : '', error.message || ''];
    const status = error.status_ !== undefined ? error.status_ : (error.customData && error.customData.status);
    if (status !== undefined) parts.push(`HTTP ${status}`);
    const response = error.serverResponse || (error.customData && error.customData.serverResponse);
    if (response) parts.push(`Réponse du serveur : ${String(response).slice(0, 400)}`);
    return parts.filter(Boolean).join(' ');
  }

  const storage = () => window.storage || firebase.storage();

  async function listFiles(ref, out) {
    const result = await ref.listAll();
    result.items.forEach(item => out.push({ ref: item, path: item.fullPath }));
    for (const prefix of result.prefixes) await listFiles(prefix, out);
  }

  /**
   * Looks for the orphan files of one app. Nothing is deleted.
   * @returns {{files, referenced, matched, orphans, tooRecent, suspicious, mostlyOrphans}}
   *   orphans / tooRecent: [{ ref, path }]
   */
  async function scan(appId, options) {
    const app = APPS[appId];
    if (!app) throw new Error('Application inconnue : ' + appId);
    const opts = options || {};
    const progress = opts.onProgress || (() => {});
    const minAge = opts.minAgeMs === undefined ? MIN_AGE_MS : opts.minAgeMs;

    // 1. every path some record refers to. A failed read must stop here: with an incomplete
    //    list, real photos would look like orphans.
    const valid = new Set();
    const buckets = new Set(), samples = [];
    let referenced = 0;
    for (const name of app.collections) {
      progress(`Lecture des enregistrements (${name})…`);
      const snapshot = await window.db.collection(name).get();
      snapshot.forEach(doc => app.urls(doc.data()).forEach(url => {
        referenced++;
        const path = pathOfUrl(url);
        if (path) { valid.add(path); if (samples.length < 3) samples.push(path); }
        const bucket = bucketOfUrl(url);
        if (bucket) buckets.add(bucket);
      }));
    }

    // 2. every file of the app's folders
    progress('Analyse du stockage Firebase…');
    const files = [];
    const listErrors = [];
    for (const folder of app.folders) {
      try {
        await listFiles(storage().ref(folder), files);
      } catch (error) {
        if (error && error.code === 'storage/unauthorized') throw error; // listing not allowed: say so
        console.warn('Dossier non analysé :', folder, error);
        listErrors.push(`${folder} : ${describeError(error)}`);
      }
    }

    // 3. the unreferenced ones, except those uploaded a moment ago
    const candidates = files.filter(file => !valid.has(file.path));
    const orphans = [], tooRecent = [];
    for (const file of candidates) {
      let created = null;
      try {
        const meta = await file.ref.getMetadata();
        created = meta && meta.timeCreated ? new Date(meta.timeCreated).getTime() : null;
        file.size = meta && meta.size ? Number(meta.size) : null;
      } catch (error) { /* no metadata: judged on the path alone */ }
      file.created = created; // shown in the list, so an orphan can be checked before deleting
      if (created && Date.now() - created < minAge) tooRecent.push(file); else orphans.push(file);
    }

    const matched = files.length - candidates.length;
    return {
      app: appId,
      files: files.length,
      referenced,
      matched,
      orphans,
      tooRecent,
      // Not one file belongs to a record: links and files do not match (e.g. storage moved) - never delete on that
      suspicious: files.length >= 5 && matched === 0,
      // Records point to photos but not one file was found in the folders: the files are somewhere else
      // (another bucket, another folder) or could not be listed. Nothing can be judged: never "no orphans".
      noFiles: referenced > 0 && files.length === 0,
      // Where the records say the photos are, versus where this app looks
      bucketsInRecords: [...buckets],
      configuredBucket: configuredBucket(),
      samplePaths: samples,
      listErrors,
      // Most files orphan: possible, but worth a second look before deleting
      mostlyOrphans: files.length >= 10 && candidates.length / files.length > 0.5
    };
  }

  /** Deletes the given files one by one. @returns {{deleted, failed}} */
  async function remove(files, options) {
    const progress = (options && options.onProgress) || (() => {});
    let deleted = 0, failed = 0;
    for (const file of files) {
      try {
        await file.ref.delete();
        deleted++;
      } catch (error) {
        console.warn('Suppression impossible :', file.path, error);
        failed++;
      }
      if ((deleted + failed) % 5 === 0) progress(`Suppression : ${deleted + failed}/${files.length}…`);
    }
    return { deleted, failed };
  }

  const esc = text => String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * Draws the "Nettoyage des fichiers orphelins" section of one app into `container` and wires it.
   * Uses the Admin pages' .management-section / .form-row styles (css/pages/data-admin.css).
   */
  function mount(container, appId, options) {
    const app = APPS[appId];
    const opts = options || {};
    container.innerHTML = `
      <div class="management-section management-section--danger">
        <div class="management-section__title">🧹 Nettoyage des fichiers orphelins</div>
        <div class="management-section__desc" data-role="desc">Recherche et supprime les photos stockées ${esc(app.noun)} qui ne sont liées à aucun enregistrement (fichiers orphelins). Analyse TOUTES les activités (Ski et Vélo) et toutes les saisons. Les fichiers de moins de 2 heures sont ignorés.</div>
        <div class="form-row">
          <div class="form-group" style="flex: 0 0 auto;"><button type="button" class="btn btn-secondary" data-role="scan">Analyser</button></div>
          <div class="form-group" style="flex: 0 0 auto;"><button type="button" class="btn btn-danger" data-role="delete" disabled>Supprimer les orphelins</button></div>
        </div>
        <div data-role="results" style="margin-top: 1rem; display: none;"></div>
      </div>`;
    const $ = role => container.querySelector(`[data-role="${role}"]`);
    let last = null;

    const show = html => { $('results').innerHTML = html; $('results').style.display = 'block'; };
    const note = text => `<p style="font-size: 0.875rem; color: var(--theme-text-secondary);">${text}</p>`;

    $('scan').addEventListener('click', async () => {
      last = null;
      $('delete').disabled = true;
      $('scan').disabled = true;
      show('<p>🔍 Analyse en cours... Cela peut prendre quelques minutes.</p>');
      try {
        last = await scan(appId, { onProgress: text => show(`<p>🔍 ${esc(text)}</p>`) });
        const counts = `${last.referenced} photo(s) référencée(s) • ${last.files} fichier(s) dans le stockage` +
          (last.tooRecent.length ? ` • ${last.tooRecent.length} fichier(s) récent(s) ignoré(s)` : '');
        if (last.noFiles) {
          const mine = last.configuredBucket;
          const other = last.bucketsInRecords.filter(b => b !== mine);
          show(`<p style="color: var(--color-danger);">⛔ Analyse impossible : ${last.referenced} photo(s) sont référencées, mais AUCUN fichier n'a été trouvé dans le stockage (dossiers : ${esc(app.folders.join(', '))}).</p>` +
            note('Cela ne veut PAS dire qu\'il n\'y a pas d\'orphelins : l\'outil ne voit simplement pas vos photos. La suppression est bloquée.') +
            note(`Stockage utilisé par l'application : <strong>${esc(mine || 'inconnu')}</strong>` + (last.bucketsInRecords.length ? ` • Les enregistrements pointent vers : <strong>${esc(last.bucketsInRecords.join(', '))}</strong>` : '')) +
            (other.length ? note('⚠️ Les photos sont dans un autre stockage que celui de l\'application (migration ?). Il faut analyser ce stockage-là.') : '') +
            (last.samplePaths.length ? note(`Exemples de chemins référencés : ${esc(last.samplePaths.join(' • '))}`) : '') +
            (last.listErrors.length ? note(`Erreurs de lecture : ${esc(last.listErrors.join(' • '))}`) : '') +
            (last.listErrors.length ? note('💡 Si l\'erreur est « HTTP 400 » ou « 403 » : dans la console Firebase > Storage > Règles, le texte doit commencer par la ligne <code>rules_version = \'2\';</code> (indispensable pour lister les fichiers), puis être publié.') : ''));
        } else if (last.suspicious) {
          show(`<p style="color: var(--color-danger);">⛔ Analyse suspecte : aucun des ${last.files} fichiers ne correspond à un enregistrement.</p>` +
            note('Les liens enregistrés ne correspondent pas aux fichiers (stockage déplacé ou migré ?). Par sécurité, la suppression est bloquée.') + note(esc(counts)));
        } else if (last.orphans.length === 0) {
          show(`<p style="color: var(--color-success);">✅ Aucun fichier orphelin trouvé!</p>${note(esc(counts))}`);
        } else {
          show(`<p style="color: var(--color-warning);">⚠️ <strong>${last.orphans.length}</strong> fichier(s) orphelin(s) trouvé(s)</p>` +
            (last.mostlyOrphans ? '<p style="color: var(--color-danger);">Attention : plus de la moitié des fichiers sont orphelins. Vérifiez la liste avant de supprimer.</p>' : '') +
            note(esc(counts)) +
            `<details style="margin-top: 0.5rem;"><summary style="cursor: pointer; color: var(--theme-accent);">Voir la liste des fichiers orphelins</summary>
              <ul style="font-size: 0.8rem; max-height: 240px; overflow-y: auto; margin-top: 0.5rem; padding-left: 1.5rem;">${last.orphans.map((f, i) => {
                const when = f.created ? ` — ${esc(new Date(f.created).toLocaleDateString('fr-CA'))}` : '';
                const size = f.size ? ` — ${Math.max(1, Math.round(f.size / 1024))} Ko` : '';
                return `<li>${esc(f.path)}${when}${size} — <a href="#" data-view="${i}">voir la photo</a></li>`;
              }).join('')}</ul></details>`);
          // "voir la photo": opens the file in a new tab, to check it before deleting
          $('results').querySelectorAll('[data-view]').forEach(link => link.addEventListener('click', async event => {
            event.preventDefault();
            try {
              const file = last && last.orphans[Number(link.dataset.view)];
              if (file) window.open(await file.ref.getDownloadURL(), '_blank', 'noopener');
            } catch (error) {
              console.warn('Cannot open the photo:', error);
              window.alert('Impossible d\'ouvrir cette photo : ' + (error.message || 'erreur inconnue'));
            }
          }));
          $('delete').disabled = false;
        }
      } catch (error) {
        console.error('Orphan scan failed:', error);
        show(`<p style="color: var(--color-danger);">❌ Erreur : ${esc(error.message)}</p>` +
          (error.code === 'storage/unauthorized' ? note('Les règles Firebase Storage doivent autoriser la lecture de la liste des fichiers.') : ''));
      } finally {
        $('scan').disabled = false;
      }
    });

    $('delete').addEventListener('click', async () => {
      if (!last || !last.orphans.length || last.suspicious) return;
      const count = last.orphans.length;
      if (!window.confirm(`Supprimer ${count} fichier(s) orphelin(s)?\n\nCette action est irréversible.`)) return;
      if (last.mostlyOrphans && !window.confirm(`Plus de la moitié des fichiers (${count} sur ${last.files}) sont orphelins.\n\nÊtes-vous VRAIMENT sûr de vouloir les supprimer?`)) return;
      $('delete').disabled = true;
      $('scan').disabled = true;
      try {
        const result = await remove(last.orphans, { onProgress: text => show(`<p>${esc(text)}</p>`) });
        last = null;
        show(`<p style="color: ${result.failed ? 'var(--color-warning)' : 'var(--color-success)'};">✅ Nettoyage terminé. ${result.deleted} fichier(s) supprimé(s)${result.failed ? `, ${result.failed} erreur(s)` : ''}.</p>`);
        if (opts.onDone) opts.onDone(result);
      } catch (error) {
        console.error('Orphan deletion failed:', error);
        show(`<p style="color: var(--color-danger);">❌ Erreur : ${esc(error.message)}</p>`);
      } finally {
        $('scan').disabled = false;
      }
    });
  }

  return { APPS, pathOfUrl, bucketOfUrl, scan, remove, mount };
})();
window.StorageCleanup = StorageCleanup;
