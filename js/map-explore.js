/**
 * map-explore.js  –  Logic for the Explore (index.html) page.
 *
 * Responsibilities:
 *   • Initialise the Leaflet map and tile layer.
 *   • Load all samples and add a coloured marker for each.
 *   • Build popup content (metadata + mini CDF chart) for each marker.
 *   • Two-click rectangle drawing for area-of-interest download (no plugins needed).
 *   • Wire up the download buttons.
 */

'use strict';

// ---------------------------------------------------------------------------
// Module-level variables
// ---------------------------------------------------------------------------

let map;                  // Leaflet map instance
let markersLayer;         // FeatureGroup holding all sample markers
let selectedSamples;      // Samples within the drawn area (or null = all)
let activePopupCanvas;    // The canvas whose Chart lives in the open popup
let adminToken = sessionStorage.getItem('gsdAdminToken') || '';

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  _syncAdminUi();
  _initMap();
  await _loadAndRender();
});

function _initMap() {
  map = L.map('map', {
    center:          CONFIG.MAP_CENTER,
    zoom:            CONFIG.MAP_ZOOM,
    zoomControl:     true,
    preferCanvas:    false,
  });

  // Base tile layer (Esri World Imagery)
  _addBasemapWithFallback(map);

  // Layer for all sample markers
  markersLayer = L.featureGroup().addTo(map);

  // Two-click rectangle drawing – capture map clicks when in draw mode.
  map.on('click', _onMapClickForDraw);
}

/**
 * Handle map clicks while in draw mode.
 * First click → stores the first corner.
 * Second click → completes the rectangle and computes area selection.
 */
function _onMapClickForDraw(e) {
  if (!_drawMode) return;

  if (!_firstCorner) {
    _firstCorner = e.latlng;
    const hint = document.getElementById('draw-hint');
    if (hint) hint.textContent = '🎯 Click again to complete the rectangle…';
  } else {
    // Second corner – draw the rectangle.
    const bounds = L.latLngBounds(_firstCorner, e.latlng);

    if (_drawnRect) map.removeLayer(_drawnRect);
    _drawnRect = L.rectangle(bounds, {
      color:       '#3388ff',
      weight:      2,
      opacity:     0.8,
      fillOpacity: 0.08,
    }).addTo(map);

    _cancelDraw();
    _computeAreaSelection(bounds);
  }
}

async function _loadAndRender() {
  const countEl = document.getElementById('sample-count');
  countEl.textContent = 'Loading samples…';

  let samples;
  try {
    samples = await loadSamples();
  } catch (err) {
    countEl.textContent = 'Failed to load samples.';
    console.error(err);
    return;
  }

  _renderMarkers(samples);
  countEl.textContent = `${samples.length} sample${samples.length !== 1 ? 's' : ''} in the database`;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

function _renderMarkers(samples) {
  markersLayer.clearLayers();

  samples.forEach(sample => {
    const lat = sample.location?.lat;
    const lng = sample.location?.lng;
    if (lat == null || lng == null) return;

    const cdf   = computeCDF(sample);
    const d50   = getDx(cdf, 50);
    const color = _colorForD50(d50);

    const marker = L.circleMarker([lat, lng], {
      radius:      8,
      fillColor:   color,
      color:       _asBool(sample.qc_checked) ? '#198754' : '#fff',
      weight:      2,
      opacity:     1,
      fillOpacity: 0.85,
    });

    marker.bindPopup(() => _buildPopupContent(sample), {
      maxWidth:  340,
      minWidth:  300,
      className: 'gsd-popup',
    });

    // Initialise the mini CDF chart once the popup DOM is ready.
    marker.on('popupopen', (e) => {
      const canvas = e.popup.getElement().querySelector('canvas.mini-cdf');
      if (canvas) {
        if (activePopupCanvas && activePopupCanvas !== canvas) {
          destroyChart(activePopupCanvas);
        }
        renderCDF(canvas, sample, { mini: true });
        activePopupCanvas = canvas;
      }
    });

    marker.on('popupclose', () => {
      if (activePopupCanvas) {
        destroyChart(activePopupCanvas);
        activePopupCanvas = null;
      }
    });

    marker.addTo(markersLayer);
  });
}

/**
 * Build the HTML string for a popup (metadata table + mini CDF canvas).
 * @param {Object} sample
 * @returns {string}
 */
function _buildPopupContent(sample) {
  const cdf   = computeCDF(sample);
  const d10   = getDx(cdf, 10);
  const d50   = getDx(cdf, 50);
  const d84   = getDx(cdf, 84);
  const total = Object.values(sample.counts || {}).reduce((a, b) => a + b, 0);

  const landformMap = {
    pool: 'Pool', riffle: 'Riffle', bar_head: 'Bar head',
    bar_top: 'Bar top', bar_tail: 'Bar tail', step: 'Step (step-pool)',
    glide: 'Glide / run', other: 'Other',
  };
  const conditionMap = {
    underwater: 'Underwater', lightly_imbricated: 'Lightly imbricated',
    heavily_imbricated: 'Heavily imbricated', recently_reworked: 'Recently reworked',
    other: 'Other',
  };

  const landform  = _esc(landformMap[sample.landform]   || sample.landform   || '–');
  const condition = _esc(conditionMap[sample.surface_condition] || sample.surface_condition || '–');
  const date      = _esc(sample.date_collected || '–');
  const river     = _esc(sample.river_name || '–');
  const showContributor = _asBool(sample.allow_public_acknowledgement);
  const collector = _esc(showContributor ? (sample.collector || '–') : 'Withheld');
  const inst      = _esc(showContributor ? (sample.institution || '') : '');
  const rawDoi    = normalizeSampleDOI(sample.paper_doi);
  const doi       = _esc(rawDoi);
  const doiHref   = rawDoi ? _esc(`https://doi.org/${rawDoi}`) : '';
  const notes     = _esc(sample.notes || '');
  const qcChecked = _asBool(sample.qc_checked);
  const qcLabel   = qcChecked ? '✅ QC checked' : '⚠ Not QC checked';
  const qcBy      = _esc(sample.qc_checked_by || '');
  const qcAt      = _esc(sample.qc_checked_at || '');
  const qcDetail  = qcChecked && (qcBy || qcAt)
    ? ` (${[qcBy, qcAt].filter(Boolean).join(' • ')})`
    : '';
  const minOpening = Number.parseFloat(sample.min_opening_mm);
  const minOpeningLabel = Number.isFinite(minOpening) && minOpening > 0 ? `${minOpening} mm` : '0.5 mm';
  const qcToggleHtml = _isAdminSignedIn() && sample.id
    ? `<button class="btn btn-sm btn-outline-dark mt-1" onclick="toggleSampleQC(${JSON.stringify(sample.id)}, ${qcChecked ? 'false' : 'true'})">${qcChecked ? 'Mark as not QC checked' : 'Mark as QC checked'}</button>`
    : '';

  const statsRow = (d10 != null && d50 != null && d84 != null)
    ? `<tr><td><b>D<sub>10</sub></b></td><td>${d10} mm</td>
           <td><b>D<sub>50</sub></b></td><td>${d50} mm</td>
           <td><b>D<sub>84</sub></b></td><td>${d84} mm</td></tr>`
    : '';

  const photosHtml = (sample.photo_urls || [])
    .map(u => _safeExternalUrl(u))
    .filter(Boolean)
    .map(u => `<a href="${_esc(u)}" target="_blank" rel="noopener noreferrer" class="me-1">📷 Photo</a>`)
    .join('');

  return `
    <div class="gsd-popup-inner">
      <h6 class="mb-1">${river}</h6>
      <table class="table table-sm table-borderless mb-1" style="font-size:0.78rem;">
        <tbody>
          <tr>
            <td><b>Date</b></td><td colspan="5">${date}</td>
          </tr>
          <tr>
            <td><b>Collector</b></td>
            <td colspan="${inst ? '3' : '5'}">${collector}</td>
            ${inst ? `<td><b>Institution</b></td><td colspan="1">${inst}</td>` : ''}
          </tr>
          ${doi ? `<tr><td><b>DOI</b></td><td colspan="5"><a href="${doiHref}" target="_blank" rel="noopener noreferrer">${doi}</a></td></tr>` : ''}
          <tr>
            <td><b>Landform</b></td><td colspan="2">${landform}</td>
            <td><b>Surface</b></td><td colspan="2">${condition}</td>
          </tr>
          <tr>
            <td><b>n</b></td><td colspan="2">${total} clasts</td>
            <td><b>Phi</b></td><td colspan="2">${sample.phi_interval === 'half' ? '½ φ' : '1 φ'}</td>
          </tr>
          <tr>
            <td><b>Min size</b></td><td colspan="5">${minOpeningLabel}</td>
          </tr>
          <tr>
            <td><b>QC</b></td><td colspan="5">${qcLabel}${qcDetail}</td>
          </tr>
          ${statsRow}
        </tbody>
      </table>
      <div style="height:160px; margin-bottom:4px;">
        <canvas class="mini-cdf" style="width:100%;height:160px;"></canvas>
      </div>
      ${notes ? `<p class="mb-1" style="font-size:0.75rem;color:#555;"><i>${notes}</i></p>` : ''}
      ${photosHtml ? `<div class="mb-1" style="font-size:0.8rem;">${photosHtml}</div>` : ''}
      ${qcToggleHtml}
    </div>`;
}

// ---------------------------------------------------------------------------
// Colour scale (D50 → hue)
// ---------------------------------------------------------------------------

/**
 * Return a CSS colour string for a given D50 value (mm).
 * Blue for fine gravel, red for boulders (log-linear interpolation).
 */
function _colorForD50(d50) {
  if (d50 == null) return '#aaa';
  const logMin = Math.log(CONFIG.MARKER_MIN_MM);
  const logMax = Math.log(CONFIG.MARKER_MAX_MM);
  const t      = Math.max(0, Math.min(1, (Math.log(d50) - logMin) / (logMax - logMin)));
  // Hue: 240° (blue) → 0° (red)
  const hue    = Math.round(240 - t * 240);
  return `hsl(${hue}, 70%, 48%)`;
}

// ---------------------------------------------------------------------------
// Draw area of interest  (two-click rectangle – no external dependency)
// ---------------------------------------------------------------------------

let _drawMode    = false;    // true when the user is drawing a rectangle
let _firstCorner = null;     // first corner LatLng
let _drawnRect   = null;     // current L.rectangle layer

/**
 * Toggle draw mode on/off.
 * Called by the "Draw Area of Interest" button in index.html.
 */
function toggleDrawMode() {
  if (_drawMode) {
    _cancelDraw();
    return;
  }

  _drawMode    = true;
  _firstCorner = null;

  const btn  = document.getElementById('draw-area-btn');
  const hint = document.getElementById('draw-hint');
  if (btn)  btn.textContent = '🚫 Cancel Drawing';
  if (hint) { hint.textContent = '🎯 Click the map to set the first corner…'; hint.classList.remove('d-none'); }

  map.getContainer().style.cursor = 'crosshair';
}

function _cancelDraw() {
  _drawMode    = false;
  _firstCorner = null;

  map.getContainer().style.cursor = '';
  const btn  = document.getElementById('draw-area-btn');
  const hint = document.getElementById('draw-hint');
  if (btn)  btn.textContent = '✏ Draw Area of Interest';
  if (hint) hint.classList.add('d-none');
}

/**
 * Clear the drawn rectangle and reset the area selection.
 */
function clearArea() {
  if (_drawnRect) { map.removeLayer(_drawnRect); _drawnRect = null; }
  selectedSamples = null;
  document.getElementById('area-download').classList.add('d-none');
  _cancelDraw();
}

function _computeAreaSelection(bounds) {
  selectedSamples = getSamples().filter(s => {
    const lat = s.location?.lat;
    const lng = s.location?.lng;
    if (lat == null || lng == null) return false;
    return bounds.contains(L.latLng(lat, lng));
  });

  const el = document.getElementById('area-download');
  el.classList.remove('d-none');
  document.getElementById('area-count').textContent =
    `${selectedSamples.length} sample${selectedSamples.length !== 1 ? 's' : ''} selected`;
}

// ---------------------------------------------------------------------------
// Download handlers (called from inline onclick attributes in index.html)
// ---------------------------------------------------------------------------

async function downloadAllData() {
  downloadFile(samplesToCSV(), 'grain-size-samples.csv', 'text/csv;charset=utf-8;');
  await _downloadBibliographyBundle(getSamples(), 'grain-size-samples-references');
}

async function downloadAllJSON() {
  downloadFile(samplesToJSON(), 'grain-size-samples.json', 'application/json');
  await _downloadBibliographyBundle(getSamples(), 'grain-size-samples-references');
}

async function downloadAreaData() {
  if (!selectedSamples) return;
  downloadFile(
    samplesToCSV(selectedSamples),
    'grain-size-samples-area.csv',
    'text/csv;charset=utf-8;',
  );
  await _downloadBibliographyBundle(selectedSamples, 'grain-size-samples-area-references');
}

async function downloadAreaJSON() {
  if (!selectedSamples) return;
  downloadFile(
    samplesToJSON(selectedSamples),
    'grain-size-samples-area.json',
    'application/json',
  );
  await _downloadBibliographyBundle(selectedSamples, 'grain-size-samples-area-references');
}

function _selectedBibliographyStyle() {
  return document.getElementById('bibliography-style')?.value || 'harvard';
}

async function _downloadBibliographyBundle(samples, baseName) {
  const style = _selectedBibliographyStyle();
  const ext = style === 'bibtex' ? 'bib' : 'txt';
  await downloadBibliographyForSamples(samples, `${baseName}.${ext}`, style);
}

function _isAdminSignedIn() {
  return !!adminToken;
}

function _syncAdminUi() {
  const signin = document.getElementById('admin-signin-btn');
  const signout = document.getElementById('admin-signout-btn');
  const status = document.getElementById('admin-status');
  if (!signin || !signout || !status) return;
  if (_isAdminSignedIn()) {
    signin.classList.add('d-none');
    signout.classList.remove('d-none');
    status.textContent = 'Admin signed in';
  } else {
    signin.classList.remove('d-none');
    signout.classList.add('d-none');
    status.textContent = 'Not signed in';
  }
}

function adminSignIn() {
  const token = window.prompt('Enter admin token to enable QC controls:');
  if (!token) return;
  adminToken = token.trim();
  sessionStorage.setItem('gsdAdminToken', adminToken);
  _syncAdminUi();
}

function adminSignOut() {
  adminToken = '';
  sessionStorage.removeItem('gsdAdminToken');
  _syncAdminUi();
}

async function toggleSampleQC(sampleId, qcChecked) {
  if (!_isAdminSignedIn()) return;
  const reviewer = window.prompt('Enter reviewer name/initials:', 'Admin') || 'Admin';
  const result = await updateSampleQC(sampleId, !!qcChecked, adminToken, reviewer.trim() || 'Admin');
  if (!result.ok) {
    window.alert(`QC update failed: ${result.message}`);
    return;
  }
  await _loadAndRender();
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function _safeExternalUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value).trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function _addBasemapWithFallback(targetMap) {
  let switched = false;
  const esri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      maxZoom: 19,
    },
  );
  esri.on('tileerror', () => {
    if (switched) return;
    switched = true;
    targetMap.removeLayer(esri);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(targetMap);
  });
  esri.addTo(targetMap);
}

function _asBool(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}
