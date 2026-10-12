/**
 * PhotoPicker - Cross-platform photo picker utility with EXIF extraction
 * 
 * FEATURES:
 * - Bottom sheet UI for Android (camera vs gallery choice)
 * - Direct picker on iOS (iOS shows its own choice sheet)
 * - Direct file picker on desktop
 * - Drag & drop support for desktop
 * - EXIF extraction (GPS coordinates + timestamp)
 * - Multiple photo support
 * - Optional per-photo "locate" button (option locationEditing): the owner places a photo on the
 *   map, or corrects its position, by clicking the geolocalisation map (PhotoMapModal.edit). The
 *   change stays in the picker (coordinates + locationEdit) and is saved with the form.
 */

class PhotoPicker {
  constructor(options = {}) {
    this.options = {
      dropZone: null,
      previewContainer: null,
      onPhotosChange: null,
      onError: null, // New: error callback for max size, invalid type, etc.
      multiple: true,
      maxPhotos: 10,
      maxFileSize: 10 * 1024 * 1024,
      accept: 'image/*',
      exifTimeout: 5000, // New: timeout for EXIF extraction (ms)
      locationEditing: false, // show a button to place / correct each photo on the map
      preferredMap: null,     // map id (or function(photo) -> map id) the relocation dialog opens on
      ...options
    };

    this._photos = [];
    this._sheet = null;
    this._panel = null;
    this._inputCam = null;
    this._inputGallery = null;
    this._resolve = null;
    this._destroyed = false;

    // Detect platform
    this._isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this._isAndroid = /Android/.test(navigator.userAgent);
    this._isDesktop = !this._isIOS && !this._isAndroid;

    this._build();
    this._setupDropZone();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  open() {
    if (this._destroyed) return Promise.resolve();
    
    this._inputCam.value = '';
    this._inputGallery.value = '';
    
    // iOS: Skip bottom sheet, iOS shows its own picker with camera/gallery choice
    // Desktop: Skip bottom sheet, open file picker directly
    if (this._isIOS || this._isDesktop) {
      this._inputGallery.click();
      return Promise.resolve();
    }
    
    // Android: Show bottom sheet (Android is inconsistent with capture attribute)
    this._showSheet();
    return new Promise(resolve => { this._resolve = resolve; });
  }

  // locationEdit (a hand-set position: see PhotoService) travels with the photo, only when there is one
  _withEdit(p, out) {
    if (p.locationEdit) out.locationEdit = p.locationEdit;
    return out;
  }

  getPhotos() {
    return this._photos.map(p => this._withEdit(p, {
      url: p.url,
      filename: p.filename,
      coordinates: p.coordinates,
      timestamp: p.timestamp
    }));
  }

  getUploadedPhotos() {
    return this._photos
      .filter(p => p.isUploaded && p.url)
      .map(p => this._withEdit(p, {
        url: p.url,
        filename: p.filename,
        coordinates: p.coordinates,
        timestamp: p.timestamp
      }));
  }

  getPendingFiles() {
    return this._photos
      .filter(p => !p.isUploaded && p.file)
      .map(p => this._withEdit(p, {
        file: p.file,
        filename: p.filename,
        coordinates: p.coordinates,
        timestamp: p.timestamp
      }));
  }

  markAsUploaded(filename, url) {
    const photo = this._photos.find(p => p.filename === filename);
    if (photo) {
      photo.url = url;
      photo.isUploaded = true;
    }
  }

  setPhotos(photos) {
    this._photos = (photos || []).map(p => ({
      file: null,
      url: p.url,
      previewUrl: p.url,
      filename: p.filename || 'photo.jpg',
      coordinates: p.coordinates || null,
      timestamp: p.timestamp ? (p.timestamp.toDate ? p.timestamp.toDate() : new Date(p.timestamp)) : null,
      locationEdit: p.locationEdit ? {
        original: p.locationEdit.original || null,
        by: p.locationEdit.by || null,
        byName: p.locationEdit.byName || null,
        at: p.locationEdit.at && p.locationEdit.at.toDate ? p.locationEdit.at.toDate() : (p.locationEdit.at || null)
      } : null,
      isUploaded: true
    }));
    this._renderPreviews();
    this._notifyChange();
  }

  clear() {
    this._photos.forEach(p => {
      if (p.previewUrl && p.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(p.previewUrl); } catch (e) { /* Safari private mode */ }
      }
    });
    this._photos = [];
    this._renderPreviews();
    this._notifyChange();
  }

  removePhoto(index) {
    if (index >= 0 && index < this._photos.length) {
      const photo = this._photos[index];
      if (photo.previewUrl && photo.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(photo.previewUrl); } catch (e) { /* Safari private mode */ }
      }
      this._photos.splice(index, 1);
      this._renderPreviews();
      this._notifyChange();
    }
  }

  hasPhotos() {
    return this._photos.length > 0;
  }

  dismiss() {
    this._hideSheet();
    if (this._resolve) {
      this._resolve();
      this._resolve = null;
    }
  }

  /**
   * Clean up resources - call when done with the picker
   */
  destroy() {
    this._destroyed = true;
    this.clear();
    
    // Remove inputs from DOM
    if (this._inputCam && this._inputCam.parentNode) {
      this._inputCam.parentNode.removeChild(this._inputCam);
    }
    if (this._inputGallery && this._inputGallery.parentNode) {
      this._inputGallery.parentNode.removeChild(this._inputGallery);
    }
    if (this._sheet && this._sheet.parentNode) {
      this._sheet.parentNode.removeChild(this._sheet);
    }
    
    this._inputCam = null;
    this._inputGallery = null;
    this._sheet = null;
    this._panel = null;
  }

  // ─── Internal: Build UI ────────────────────────────────────────────────────

  _build() {
    this._inputCam = document.createElement('input');
    this._inputCam.type = 'file';
    this._inputCam.accept = this.options.accept;
    this._inputCam.capture = 'environment';
    this._inputCam.multiple = false;
    this._inputCam.setAttribute('aria-label', 'Prendre une photo');
    Object.assign(this._inputCam.style, { display: 'none', position: 'fixed' });
    this._inputCam.addEventListener('change', e => this._onFilesSelected(e.target.files));

    this._inputGallery = document.createElement('input');
    this._inputGallery.type = 'file';
    this._inputGallery.accept = this.options.accept;
    this._inputGallery.multiple = this.options.multiple;
    this._inputGallery.setAttribute('aria-label', 'Choisir des photos');
    Object.assign(this._inputGallery.style, { display: 'none', position: 'fixed' });
    this._inputGallery.addEventListener('change', e => this._onFilesSelected(e.target.files));

    document.body.appendChild(this._inputCam);
    document.body.appendChild(this._inputGallery);

    // Only build bottom sheet for Android
    if (this._isAndroid) {
      this._buildSheet();
    }
  }

  _buildSheet() {
    this._sheet = document.createElement('div');
    this._sheet.className = 'photo-picker-sheet';
    this._sheet.setAttribute('role', 'dialog');
    this._sheet.setAttribute('aria-modal', 'true');
    this._sheet.setAttribute('aria-label', 'Ajouter une photo');
    this._sheet.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;';

    // Note: backdrop-filter may not work on older Android WebViews, but degrades gracefully
    this._sheet.innerHTML = `
      <div class="pp-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,0.5);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);"></div>
      <div class="pp-panel" style="position:absolute;bottom:0;left:0;right:0;background:var(--theme-surface,#fff);border-radius:16px 16px 0 0;padding:0 0 env(safe-area-inset-bottom,0);box-shadow:0 -4px 24px rgba(0,0,0,0.18);transform:translateY(100%);transition:transform 0.28s cubic-bezier(0.32,0.72,0,1);">
        <div style="width:40px;height:4px;background:var(--theme-border,#d1d5db);border-radius:2px;margin:12px auto 0;"></div>
        <p style="text-align:center;font-size:0.8rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--theme-text-secondary,#6b7280);margin:12px 0 4px;">Ajouter une photo</p>
        <div style="padding:8px 16px 16px;display:flex;flex-direction:column;gap:10px;">
          <button type="button" class="pp-btn-camera" aria-label="Prendre une photo avec la caméra" style="display:flex;align-items:center;gap:14px;padding:15px 20px;border:none;border-radius:12px;background:var(--theme-accent,#1e40af);color:#fff;font-size:1rem;font-weight:600;cursor:pointer;width:100%;text-align:left;">
            <span style="font-size:1.6rem;line-height:1;">📷</span><span>Prendre une photo</span>
          </button>
          <button type="button" class="pp-btn-gallery" aria-label="Choisir depuis la galerie" style="display:flex;align-items:center;gap:14px;padding:15px 20px;border:2px solid var(--theme-accent,#1e40af);border-radius:12px;background:transparent;color:var(--theme-accent,#1e40af);font-size:1rem;font-weight:600;cursor:pointer;width:100%;text-align:left;">
            <span style="font-size:1.6rem;line-height:1;">🖼️</span><span>Choisir depuis la galerie</span>
          </button>
          <button type="button" class="pp-btn-cancel" aria-label="Annuler" style="padding:13px 20px;border:none;border-radius:12px;background:var(--theme-surface-alt,#f3f4f6);color:var(--theme-text,#374151);font-size:1rem;font-weight:500;cursor:pointer;width:100%;">Annuler</button>
        </div>
      </div>
    `;

    this._panel = this._sheet.querySelector('.pp-panel');
    this._sheet.querySelector('.pp-backdrop').addEventListener('click', () => this.dismiss());
    this._sheet.querySelector('.pp-btn-cancel').addEventListener('click', () => this.dismiss());
    this._sheet.querySelector('.pp-btn-camera').addEventListener('click', () => {
      this._hideSheet();
      setTimeout(() => this._inputCam.click(), 120);
    });
    this._sheet.querySelector('.pp-btn-gallery').addEventListener('click', () => {
      this._hideSheet();
      setTimeout(() => this._inputGallery.click(), 120);
    });

    document.body.appendChild(this._sheet);
  }

  _setupDropZone() {
    const dropZone = this.options.dropZone;
    if (!dropZone) return;

    dropZone.style.cursor = 'pointer';
    dropZone.addEventListener('click', (e) => {
      if (e.target.closest('.photo-preview-item')) return;
      this.open();
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) this._onFilesSelected(files);
    });
  }

  _showSheet() {
    if (!this._sheet) return;
    this._sheet.style.display = 'block';
    void this._sheet.offsetWidth;
    this._panel.style.transform = 'translateY(0)';
    document.body.style.overflow = 'hidden';
  }

  _hideSheet() {
    if (!this._sheet) return;
    this._panel.style.transform = 'translateY(100%)';
    document.body.style.overflow = '';
    setTimeout(() => { this._sheet.style.display = 'none'; }, 280);
  }

  // ─── Internal: Error Handling ──────────────────────────────────────────────

  _emitError(type, message, file = null) {
    console.warn(`PhotoPicker: ${message}`);
    if (typeof this.options.onError === 'function') {
      this.options.onError({ type, message, file });
    }
  }

  // ─── Internal: File Handling ───────────────────────────────────────────────

  _isValidImageType(file) {
    // Accept standard image types + HEIC/HEIF (iOS)
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    if (validTypes.includes(file.type.toLowerCase())) return true;
    // Fallback: check extension for files with empty/generic type
    const ext = file.name.split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext);
  }

  async _onFilesSelected(fileList) {
    if (this._destroyed) return;
    
    const files = Array.from(fileList || []);
    if (!files.length) {
      if (this._resolve) { this._resolve(); this._resolve = null; }
      return;
    }

    const remaining = this.options.maxPhotos - this._photos.length;
    if (remaining <= 0) {
      this._emitError('max_photos', `Maximum ${this.options.maxPhotos} photos atteint`);
      if (this._resolve) { this._resolve(); this._resolve = null; }
      return;
    }
    
    const toProcess = files.slice(0, remaining);

    for (const file of toProcess) {
      // Validate image type
      if (!this._isValidImageType(file)) {
        this._emitError('invalid_type', `${file.name}: type de fichier non supporté`, file);
        continue;
      }
      
      // Validate file size
      if (file.size > this.options.maxFileSize) {
        const maxMB = Math.round(this.options.maxFileSize / 1024 / 1024);
        this._emitError('max_size', `${file.name}: fichier trop volumineux (max ${maxMB}MB)`, file);
        continue;
      }

      let coordinates = null;
      let timestamp = null;
      try {
        const exifData = await this._extractExifData(file);
        if (exifData) {
          coordinates = this._extractGpsFromExif(exifData);
          timestamp = this._extractTimestampFromExif(exifData);
        }
      } catch (err) {
        console.warn('EXIF extraction failed:', err);
      }

      // Create preview URL with Safari private mode protection
      let previewUrl = null;
      try {
        previewUrl = URL.createObjectURL(file);
      } catch (e) {
        console.warn('Could not create preview URL:', e);
      }

      this._photos.push({
        file: file,
        url: null,
        previewUrl: previewUrl,
        filename: file.name,
        coordinates: coordinates,
        timestamp: timestamp,
        isUploaded: false
      });
    }

    this._renderPreviews();
    this._notifyChange();

    if (this._resolve) { this._resolve(); this._resolve = null; }
  }

  // ─── Internal: EXIF Extraction ─────────────────────────────────────────────

  _extractExifData(file) {
    return new Promise((resolve) => {
      if (typeof EXIF === 'undefined') { resolve(null); return; }
      
      // Timeout protection - EXIF.getData can hang on corrupt files
      const timeoutId = setTimeout(() => {
        console.warn('EXIF extraction timed out');
        resolve(null);
      }, this.options.exifTimeout);
      
      try {
        EXIF.getData(file, function() {
          clearTimeout(timeoutId);
          const tags = EXIF.getAllTags(this);
          resolve(tags && Object.keys(tags).length > 0 ? tags : null);
        });
      } catch (e) {
        clearTimeout(timeoutId);
        resolve(null);
      }
    });
  }

  _extractGpsFromExif(exifData) {
    if (!exifData) return null;
    const lat = exifData.GPSLatitude, latRef = exifData.GPSLatitudeRef;
    const lon = exifData.GPSLongitude, lonRef = exifData.GPSLongitudeRef;
    if (!lat || !lon || !latRef || !lonRef) return null;
    try {
      const toDecimal = (dms, ref) => {
        const d = typeof dms[0] === 'object' ? dms[0].numerator / dms[0].denominator : dms[0];
        const m = typeof dms[1] === 'object' ? dms[1].numerator / dms[1].denominator : dms[1];
        const s = typeof dms[2] === 'object' ? dms[2].numerator / dms[2].denominator : dms[2];
        let dec = d + m/60 + s/3600;
        if (ref === 'S' || ref === 'W') dec = -dec;
        return Math.round(dec * 1000000) / 1000000;
      };
      return { latitude: toDecimal(lat, latRef), longitude: toDecimal(lon, lonRef) };
    } catch (e) { return null; }
  }

  _extractTimestampFromExif(exifData) {
    if (!exifData) return null;
    const dateStr = exifData.DateTimeOriginal || exifData.DateTime;
    if (!dateStr) return null;
    try {
      const [datePart, timePart] = dateStr.split(' ');
      const [year, month, day] = datePart.split(':');
      const [hour, min, sec] = timePart.split(':');
      return new Date(year, month - 1, day, hour, min, sec);
    } catch (e) { return null; }
  }

  // ─── Internal: Preview Rendering ───────────────────────────────────────────

  _renderPreviews() {
    const container = this.options.previewContainer;
    if (!container) return;

    container.innerHTML = '';

    this._photos.forEach((photo, index) => {
      const item = document.createElement('div');
      item.className = 'photo-preview-item';
      item.style.cssText = 'position:relative;display:inline-block;margin:4px;';

      const img = document.createElement('img');
      img.src = photo.previewUrl || photo.url || '';
      img.alt = photo.filename;
      img.style.cssText = 'width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid var(--theme-border,#e5e7eb);';
      
      // Handle broken images gracefully
      img.onerror = () => {
        img.style.background = 'var(--theme-surface-alt, #f3f4f6)';
        img.alt = 'Image non disponible';
      };

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.innerHTML = '×';
      removeBtn.setAttribute('aria-label', `Supprimer ${photo.filename}`);
      removeBtn.style.cssText = 'position:absolute;top:-6px;right:-6px;width:22px;height:22px;border:none;border-radius:50%;background:#ef4444;color:white;font-size:14px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;';
      removeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.removePhoto(index); });

      if (this.options.locationEditing && typeof PhotoMapModal !== 'undefined') {
        const locateBtn = document.createElement('button');
        locateBtn.type = 'button';
        locateBtn.textContent = photo.coordinates ? '✏️' : '📍 Ajouter';
        const label = photo.coordinates ? 'Modifier la localisation de la photo' : 'Ajouter une localisation à la photo';
        locateBtn.title = label;
        locateBtn.setAttribute('aria-label', label);
        locateBtn.style.cssText = 'position:absolute;bottom:4px;right:4px;font-size:12px;line-height:1;border:none;border-radius:4px;padding:3px 5px;cursor:pointer;background:rgba(255,255,255,0.92);color:#111827;';
        locateBtn.addEventListener('click', (e) => { e.stopPropagation(); this._editLocation(index); });
        item.appendChild(locateBtn);
      }

      if (photo.coordinates) {
        const gpsIndicator = document.createElement('span');
        gpsIndicator.innerHTML = '📍';
        gpsIndicator.setAttribute('aria-label', 'Photo géolocalisée');
        gpsIndicator.title = `GPS: ${photo.coordinates.latitude}, ${photo.coordinates.longitude}` + (photo.locationEdit ? ' (position modifiée)' : '');
        gpsIndicator.style.cssText = 'position:absolute;bottom:4px;left:4px;font-size:14px;background:rgba(255,255,255,0.9);border-radius:4px;padding:2px 4px;';
        item.appendChild(gpsIndicator);
      }

      item.appendChild(img);
      item.appendChild(removeBtn);
      container.appendChild(item);
    });

    container.style.display = this._photos.length > 0 ? 'block' : 'none';
  }

  // ─── Internal: hand-set location (saved with the form, not on its own) ────────────────────

  _editLocation(index) {
    const photo = this._photos[index];
    if (!photo || typeof PhotoMapModal === 'undefined') return;
    const preferred = typeof this.options.preferredMap === 'function' ? this.options.preferredMap(photo) : this.options.preferredMap;
    PhotoMapModal.edit({
      photoUrl: photo.previewUrl || photo.url,
      coordinates: photo.coordinates,
      original: photo.locationEdit ? photo.locationEdit.original : null,
      preferred: preferred || undefined,
      save: async (change) => {
        // the photo may have moved in the list while the dialog was open
        const i = this._photos.indexOf(photo);
        if (i === -1) return;
        const next = PhotoService.relocate(photo, change, PhotoService.currentEditor(), new Date());
        photo.coordinates = next.coordinates || null;
        if (next.locationEdit) photo.locationEdit = next.locationEdit; else delete photo.locationEdit;
        this._renderPreviews();
        this._notifyChange();
      }
    });
  }

  _notifyChange() {
    if (typeof this.options.onPhotosChange === 'function') {
      this.options.onPhotosChange(this.getPhotos());
    }
  }
}

if (typeof window !== 'undefined') {
  window.PhotoPicker = PhotoPicker;
}
