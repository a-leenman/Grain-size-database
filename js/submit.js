/**
 * submit.js  –  Logic for the Submit Sample (submit.html) page.
 *
 * Responsibilities:
 *   • Leaflet mini-map for clicking a location.
 *   • Coordinate inputs (lat / lng) kept in sync with the map click.
 *   • Phi-interval radio buttons toggling the grain-size entry table.
 *   • Live CDF preview rendered via cdf.js.
 *   • Form validation and submission via data.js.
 */

'use strict';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let submitMap;          // Leaflet map instance on submit page
let locationMarker;     // Draggable marker for the selected location
let previewChartCanvas; // <canvas> for the live CDF preview
let draftSampleId = null; // Reused between retries to avoid duplicate submissions

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  _setDateMaxToToday();
  _initSubmitMap();
  _initPhiToggle();
  _initCoordInputs();
  _initFormValidation();
  _renderBinTable('full');
});

// ---------------------------------------------------------------------------
// 1.  Location map
// ---------------------------------------------------------------------------

function _initSubmitMap() {
  submitMap = L.map('submit-map', {
    center:       CONFIG.MAP_CENTER,
    zoom:         CONFIG.MAP_ZOOM,
    zoomControl:  true,
  });

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom:     19,
  }).addTo(submitMap);

  submitMap.on('click', (e) => {
    _setLocation(e.latlng.lat, e.latlng.lng);
  });
}

/**
 * Place / move the location marker and sync the coordinate text inputs.
 */
function _setLocation(lat, lng) {
  lat = parseFloat(lat.toFixed(6));
  lng = parseFloat(lng.toFixed(6));

  document.getElementById('lat').value = lat;
  document.getElementById('lng').value = lng;

  if (locationMarker) {
    locationMarker.setLatLng([lat, lng]);
  } else {
    locationMarker = L.marker([lat, lng], { draggable: true }).addTo(submitMap);
    locationMarker.on('dragend', () => {
      const pos = locationMarker.getLatLng();
      _setLocation(pos.lat, pos.lng);
    });
  }
}

// Keep map marker in sync when the user types coordinates directly.
function _initCoordInputs() {
  ['lat', 'lng'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const lat = parseFloat(document.getElementById('lat').value);
      const lng = parseFloat(document.getElementById('lng').value);
      if (!isNaN(lat) && !isNaN(lng)) {
        _setLocation(lat, lng);
        submitMap.setView([lat, lng], Math.max(submitMap.getZoom(), CONFIG.COORD_INPUT_MIN_ZOOM));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 2.  Phi-interval toggle → rebuild the count table
// ---------------------------------------------------------------------------

function _initPhiToggle() {
  document.querySelectorAll('input[name="phi_interval"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      _renderBinTable(e.target.value);
      _updatePreview();
    });
  });
}

/**
 * Render (or re-render) the grain-size count input table.
 * @param {'full'|'half'} interval
 */
function _renderBinTable(interval) {
  const bins  = interval === 'half' ? BINS_HALF : BINS_FULL;
  const tbody = document.getElementById('bin-table-body');
  if (!tbody) return;

  const previousCounts = {};
  tbody.querySelectorAll('.bin-count').forEach(input => {
    const key = input.dataset.binKey;
    if (!key) return;
    previousCounts[key] = Math.max(0, parseInt(input.value, 10) || 0);
  });

  tbody.innerHTML = '';
  bins.forEach(bin => {
    const count = previousCounts[bin.key] ?? 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-nowrap">${bin.label}</td>
      <td class="text-muted small text-nowrap">${bin.phiLabel}</td>
      <td>
        <input type="number" class="form-control form-control-sm bin-count text-end"
               id="bin-${_idSafe(bin.key)}"
               data-bin-key="${bin.key}"
               min="0" step="1" value="${count}"
               aria-label="${bin.label} count">
      </td>`;
    tbody.appendChild(tr);
  });

  // Live update the preview when any count changes.
  tbody.querySelectorAll('.bin-count').forEach(input => {
    input.addEventListener('input', _updatePreview);
  });
}

// ---------------------------------------------------------------------------
// 3.  Live CDF preview
// ---------------------------------------------------------------------------

function _updatePreview() {
  const previewSection     = document.getElementById('preview-section');
  const previewPlaceholder = document.getElementById('preview-placeholder');
  if (!previewSection) return;

  const sample = _buildSampleFromForm();
  if (!sample) {
    previewSection.classList.add('d-none');
    if (previewPlaceholder) previewPlaceholder.classList.remove('d-none');
    return;
  }

  const total = Object.values(sample.counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    previewSection.classList.add('d-none');
    if (previewPlaceholder) previewPlaceholder.classList.remove('d-none');
    return;
  }

  previewSection.classList.remove('d-none');
  if (previewPlaceholder) previewPlaceholder.classList.add('d-none');

  if (!previewChartCanvas) {
    previewChartCanvas = document.getElementById('preview-canvas');
  }
  if (previewChartCanvas) {
    renderCDF(previewChartCanvas, sample, {
      title: `${sample.river_name || 'Sample'} – CDF preview`,
    });
  }

  // Update summary statistics.
  const cdf   = computeCDF(sample);
  const d10   = getDx(cdf, 10);
  const d50   = getDx(cdf, 50);
  const d84   = getDx(cdf, 84);
  const stats = document.getElementById('preview-stats');
  if (stats) {
    stats.innerHTML =
      `<strong>n</strong> = ${total} &nbsp;|&nbsp; ` +
      `<strong>D<sub>10</sub></strong> = ${d10 ?? '–'} mm &nbsp;|&nbsp; ` +
      `<strong>D<sub>50</sub></strong> = ${d50 ?? '–'} mm &nbsp;|&nbsp; ` +
      `<strong>D<sub>84</sub></strong> = ${d84 ?? '–'} mm`;
  }
}

// ---------------------------------------------------------------------------
// 4.  Form validation & submission
// ---------------------------------------------------------------------------

function _initFormValidation() {
  const form = document.getElementById('submit-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    _hideExportButton();
    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }

    const sample = _buildSampleFromForm();
    if (!sample) return;

    // Validate location
    if (sample.location.lat == null || sample.location.lng == null) {
      _showAlert('Please specify a location (click on the map or enter coordinates).', 'danger');
      return;
    }

    // Validate that at least some counts are non-zero
    const total = Object.values(sample.counts).reduce((a, b) => a + b, 0);
    if (total === 0) {
      _showAlert('Please enter at least one non-zero grain count.', 'danger');
      return;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const result = await saveSample(sample);
    draftSampleId = sample.id || draftSampleId;

    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Sample';

    if (result.ok) {
      _showAlertHtml(`${_esc(result.message)} <a href="index.html">View on map →</a>`, 'success');
      form.reset();
      draftSampleId = null;
      form.classList.remove('was-validated');
      _renderBinTable(_getPhiInterval());
      if (locationMarker) { submitMap.removeLayer(locationMarker); locationMarker = null; }
      const previewSection = document.getElementById('preview-section');
      if (previewSection) previewSection.classList.add('d-none');
      const previewPlaceholder = document.getElementById('preview-placeholder');
      if (previewPlaceholder) previewPlaceholder.classList.remove('d-none');
      if (previewChartCanvas) { destroyChart(previewChartCanvas); previewChartCanvas = null; }
      _hideExportButton();
    } else {
      _showAlertText(result.message, 'warning');

      // Offer a manual JSON download as fallback.
      const exportBtn = document.getElementById('export-btn');
      if (exportBtn) {
        exportBtn.classList.remove('d-none');
        exportBtn.onclick = () => {
          downloadFile(
            JSON.stringify({ samples: [sample] }, null, 2),
            `sample-${sample.id}.json`,
            'application/json',
          );
        };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect all form values and return a sample object (or null on error).
 */
function _buildSampleFromForm() {
  const interval = _getPhiInterval();
  const bins     = interval === 'half' ? BINS_HALF : BINS_FULL;

  const counts = {};
  bins.forEach(bin => {
    const el = document.getElementById(`bin-${_idSafe(bin.key)}`);
    counts[bin.key] = el ? Math.max(0, parseInt(el.value, 10) || 0) : 0;
  });

  const photoUrlsRaw = document.getElementById('photo_urls')?.value || '';
  const photo_urls   = photoUrlsRaw.split('\n')
    .map(u => u.trim()).filter(Boolean);

  const latRaw = parseFloat(document.getElementById('lat')?.value);
  const lngRaw = parseFloat(document.getElementById('lng')?.value);
  const lat = Number.isFinite(latRaw) ? latRaw : null;
  const lng = Number.isFinite(lngRaw) ? lngRaw : null;

  return {
    id:               draftSampleId || undefined,
    collector:        document.getElementById('collector')?.value.trim()        || '',
    institution:      document.getElementById('institution')?.value.trim()      || '',
    paper_doi:        document.getElementById('paper_doi')?.value.trim()        || '',
    river_name:       document.getElementById('river_name')?.value.trim()       || '',
    date_collected:   document.getElementById('date_collected')?.value          || '',
    landform:         document.getElementById('landform')?.value                || '',
    surface_condition:document.getElementById('surface_condition')?.value       || '',
    phi_interval:     interval,
    counts,
    notes:            document.getElementById('notes')?.value.trim()            || '',
    photo_urls,
    location: {
      lat,
      lng,
      description: document.getElementById('loc_description')?.value.trim() || '',
    },
  };
}

function _getPhiInterval() {
  return document.querySelector('input[name="phi_interval"]:checked')?.value || 'full';
}

function _showAlert(html, type) {
  const container = document.getElementById('alert-container');
  if (!container) return;
  container.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show" role="alert">
      ${html}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`;
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _showAlertHtml(html, type) {
  _showAlert(html, type);
}

function _showAlertText(text, type) {
  _showAlert(_esc(text), type);
}

function _hideExportButton() {
  const exportBtn = document.getElementById('export-btn');
  if (!exportBtn) return;
  exportBtn.classList.add('d-none');
  exportBtn.onclick = null;
}

// Keep the date input's max attribute set to today's local date (no future dates).
function _setDateMaxToToday() {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  const today = new Date(now.getTime() - tzOffsetMs).toISOString().split('T')[0];
  const dateEl = document.getElementById('date_collected');
  if (dateEl) dateEl.setAttribute('max', today);
}

/** Make a bin key safe for use in an HTML id attribute. */
function _idSafe(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
