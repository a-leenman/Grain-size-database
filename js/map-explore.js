/**
 * map-explore.js  –  Logic for the Explore (index.html) page.
 *
 * Responsibilities:
 *   • Initialise the Leaflet map and tile layer.
 *   • Load all samples and add a coloured marker for each.
 *   • Build popup content (metadata + mini CDF chart) for each marker.
 *   • Provide Leaflet.draw integration for draw-area-of-interest downloads.
 *   • Wire up the download buttons.
 */

'use strict';

// ---------------------------------------------------------------------------
// Module-level variables
// ---------------------------------------------------------------------------

let map;                  // Leaflet map instance
let markersLayer;         // FeatureGroup holding all sample markers
let drawControl;          // Leaflet.draw control
let drawnItems;           // FeatureGroup for the drawn rectangle
let selectedSamples;      // Samples within the drawn area (or null = all)
let activePopupCanvas;    // The canvas whose Chart lives in the open popup

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
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

  // Base tile layer (OpenStreetMap)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom:     19,
  }).addTo(map);

  // Layer for all sample markers
  markersLayer = L.featureGroup().addTo(map);

  // Layer for the drawn area-of-interest polygon
  drawnItems = new L.FeatureGroup().addTo(map);
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
      color:       '#fff',
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
    bar_top: 'Bar top', bar_tail: 'Bar tail', other: 'Other',
  };
  const conditionMap = {
    underwater: 'Underwater', lightly_imbricated: 'Lightly imbricated',
    heavily_imbricated: 'Heavily imbricated', recently_reworked: 'Recently reworked',
    other: 'Other',
  };

  const landform  = landformMap[sample.landform]   || sample.landform   || '–';
  const condition = conditionMap[sample.surface_condition] || sample.surface_condition || '–';
  const date      = sample.date_collected || '–';
  const river     = _esc(sample.river_name || '–');
  const collector = _esc(sample.collector  || '–');
  const inst      = _esc(sample.institution || '');
  const notes     = _esc(sample.notes || '');

  const statsRow = (d10 != null && d50 != null && d84 != null)
    ? `<tr><td><b>D<sub>10</sub></b></td><td>${d10} mm</td>
           <td><b>D<sub>50</sub></b></td><td>${d50} mm</td>
           <td><b>D<sub>84</sub></b></td><td>${d84} mm</td></tr>`
    : '';

  const photosHtml = (sample.photo_urls || [])
    .filter(Boolean)
    .map(u => `<a href="${_esc(u)}" target="_blank" class="me-1">📷 Photo</a>`)
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
          <tr>
            <td><b>Landform</b></td><td colspan="2">${landform}</td>
            <td><b>Surface</b></td><td colspan="2">${condition}</td>
          </tr>
          <tr>
            <td><b>n</b></td><td colspan="2">${total} clasts</td>
            <td><b>Phi</b></td><td colspan="2">${sample.phi_interval === 'half' ? '½ φ' : '1 φ'}</td>
          </tr>
          ${statsRow}
        </tbody>
      </table>
      <div style="height:160px; margin-bottom:4px;">
        <canvas class="mini-cdf" style="width:100%;height:160px;"></canvas>
      </div>
      ${notes ? `<p class="mb-1" style="font-size:0.75rem;color:#555;"><i>${notes}</i></p>` : ''}
      ${photosHtml ? `<div class="mb-1" style="font-size:0.8rem;">${photosHtml}</div>` : ''}
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
// Draw area of interest
// ---------------------------------------------------------------------------

/**
 * Toggle Leaflet.draw mode (draw-rectangle).
 * Called by the "Draw Area of Interest" button.
 */
function toggleDrawMode() {
  if (drawControl) {
    // Already in draw mode → cancel
    map.removeControl(drawControl);
    drawControl = null;
    drawnItems.clearLayers();
    selectedSamples = null;
    document.getElementById('area-download').classList.add('d-none');
    return;
  }

  drawControl = new L.Control.Draw({
    draw: {
      rectangle: true,
      polygon:   false,
      polyline:  false,
      circle:    false,
      circlemarker: false,
      marker:    false,
    },
    edit: {
      featureGroup: drawnItems,
      remove: true,
    },
  });
  map.addControl(drawControl);

  map.once(L.Draw.Event.CREATED, (e) => {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);
    _computeAreaSelection(e.layer.getBounds());
  });
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
  el.querySelector('#area-count').textContent =
    `${selectedSamples.length} sample${selectedSamples.length !== 1 ? 's' : ''} selected`;
}

/**
 * Clear the drawn area selection.
 */
function clearArea() {
  drawnItems.clearLayers();
  selectedSamples = null;
  document.getElementById('area-download').classList.add('d-none');
  if (drawControl) {
    map.removeControl(drawControl);
    drawControl = null;
  }
}

// ---------------------------------------------------------------------------
// Download handlers (called from inline onclick attributes in index.html)
// ---------------------------------------------------------------------------

function downloadAllData() {
  downloadFile(samplesToCSV(), 'grain-size-samples.csv', 'text/csv;charset=utf-8;');
}

function downloadAllJSON() {
  downloadFile(samplesToJSON(), 'grain-size-samples.json', 'application/json');
}

function downloadAreaData() {
  if (!selectedSamples) return;
  downloadFile(
    samplesToCSV(selectedSamples),
    'grain-size-samples-area.csv',
    'text/csv;charset=utf-8;',
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
