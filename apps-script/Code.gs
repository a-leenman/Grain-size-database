/**
 * Google Apps Script backend for the Riverbed Grain Size Database.
 *
 * SETUP INSTRUCTIONS
 * ──────────────────
 * 1. Go to https://script.google.com and create a new project.
 * 2. Paste this entire file into the editor (replacing the default content).
 * 3. Create a Google Sheet and copy its ID from the URL:
 *      https://docs.google.com/spreadsheets/d/SHEET_ID/edit
 * 4. Set the SHEET_ID constant below.
 * 5. Click Deploy → New Deployment → Web App.
 *    • Execute as: Me (your Google account)
 *    • Who has access: Anyone
 * 6. Copy the deployment URL and set CONFIG.API_URL in js/config.js.
 * 7. (Optional) To sync to OneDrive: enable Google Drive sync with your
 *    university OneDrive account, and place the Sheet in a synced folder.
 *
 * ENDPOINTS
 * ─────────
 * GET  ?action=getData            → returns all samples as JSON
 * POST body (text/plain JSON)     → { action: 'submit', token: '...', data: <sample> }
 */

// ── Configuration ──────────────────────────────────────────────────────────
const SHEET_ID    = 'YOUR_GOOGLE_SHEET_ID_HERE';
const SHEET_NAME  = 'Samples';   // Tab name inside the Google Sheet
const SUBMIT_TOKEN = 'CHANGE_ME_TO_A_STRONG_SECRET';

// Decimal places used when writing Dx percentile statistics to the sheet.
// Must match CONFIG.DX_PRECISION in js/config.js.
const DX_PRECISION = 2;

// ── Column headers written to the sheet ────────────────────────────────────
const HEADERS = [
  'id', 'timestamp', 'date_collected', 'collector', 'institution',
  'allow_public_acknowledgement', 'river_name', 'paper_doi', 'lat', 'lng', 'location_description',
  'landform', 'surface_condition', 'phi_interval',
  'total_count', 'D10_mm', 'D50_mm', 'D84_mm',
  'notes', 'photo_urls',
  'counts_json',   // raw JSON blob of the full counts object
];

// ── CORS helper ─────────────────────────────────────────────────────────────
function _corsResponse(data) {
  const output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ── GET handler ─────────────────────────────────────────────────────────────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'getData';

  if (action === 'getData') {
    try {
      const samples = _getAllSamples();
      return _corsResponse({ status: 'ok', samples });
    } catch (err) {
      return _corsResponse({ status: 'error', message: err.message });
    }
  }

  return _corsResponse({ status: 'error', message: 'Unknown action: ' + action });
}

// ── POST handler ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.action !== 'submit') {
      return _corsResponse({ status: 'error', message: 'Unknown action' });
    }
    if (!_isValidSubmitToken(payload.token)) {
      return _corsResponse({ status: 'error', message: 'Unauthorized submit request' });
    }

    const sample = payload.data;
    if (!sample || !sample.id) {
      return _corsResponse({ status: 'error', message: 'Invalid sample data' });
    }

    _appendSample(sample);
    return _corsResponse({ status: 'ok', message: 'Sample saved.' });

  } catch (err) {
    return _corsResponse({ status: 'error', message: err.message });
  }
}

function _isValidSubmitToken(token) {
  return !!SUBMIT_TOKEN && token === SUBMIT_TOKEN;
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────

function _getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    // Freeze the header row
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _appendSample(sample) {
  const sheet = _getSheet();

  // Make sure headers exist
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }

  // Compute simple statistics from counts (replicating js/bins.js logic)
  const stats = _computeStats(sample);

  const lat = (sample.location && sample.location.lat);
  const lng = (sample.location && sample.location.lng);
  const row = [
    sample.id,
    sample.timestamp || new Date().toISOString(),
    sample.date_collected || '',
    sample.collector || '',
    sample.institution || '',
    _toBool(sample.allow_public_acknowledgement),
    sample.river_name || '',
    sample.paper_doi || '',
    Number.isFinite(lat) ? lat : '',
    Number.isFinite(lng) ? lng : '',
    (sample.location && sample.location.description) || '',
    sample.landform || '',
    sample.surface_condition || '',
    sample.phi_interval || 'full',
    stats.total,
    stats.d10 || '',
    stats.d50 || '',
    stats.d84 || '',
    sample.notes || '',
    (sample.photo_urls || []).join('; '),
    JSON.stringify(sample.counts || {}),
  ];

  const dataRows = Math.max(0, sheet.getLastRow() - 1);
  const idValues = dataRows > 0
    ? sheet.getRange(2, 1, dataRows, 1).getValues()
    : [];
  const existingIndex = idValues.findIndex(r => String(r[0]) === String(sample.id));
  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2; // account for header row
    sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function _getAllSamples() {
  const sheet = _getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];   // no data rows

  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

  const parseCoord = (value) => {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : null;
  };

  return data.map(row => {
    const obj = {};
    HEADERS.forEach((h, i) => { obj[h] = row[i]; });

    // Re-inflate the counts JSON blob
    let counts = {};
    try { counts = JSON.parse(obj.counts_json || '{}'); } catch (e) { /* ignore */ }

    return {
      id:                obj.id,
      timestamp:         obj.timestamp,
      date_collected:    obj.date_collected,
      collector:         obj.collector,
      institution:       obj.institution,
      allow_public_acknowledgement: _toBool(obj.allow_public_acknowledgement),
      river_name:        obj.river_name,
      paper_doi:         obj.paper_doi || '',
      location: {
        lat:         parseCoord(obj.lat),
        lng:         parseCoord(obj.lng),
        description: obj.location_description || '',
      },
      landform:          obj.landform,
      surface_condition: obj.surface_condition,
      phi_interval:      obj.phi_interval || 'full',
      counts,
      notes:             obj.notes || '',
      photo_urls:        obj.photo_urls ? obj.photo_urls.split('; ').filter(Boolean) : [],
    };
  });
}

// ── Simple statistics (mirrors getDx in js/bins.js) ──────────────────────────

function _computeStats(sample) {
  const interval = sample.phi_interval === 'half' ? 0.5 : 1.0;
  const boundaries = _generateBoundaries(interval);

  const counts = sample.counts || {};
  let total = 0;
  boundaries.forEach(b => { total += (parseInt(counts[b.key], 10) || 0); });

  if (total === 0) return { total: 0, d10: null, d50: null, d84: null };

  // Build CDF
  let cumulative = 0;
  const cdfMm  = [];
  const cdfPct = [];
  boundaries.forEach(b => {
    cumulative += (parseInt(counts[b.key], 10) || 0);
    if (isFinite(b.upperMm)) {
      cdfMm.push(b.upperMm);
      cdfPct.push(cumulative / total * 100);
    }
  });

  return {
    total,
    d10: _interpolateDx(cdfMm, cdfPct, 10),
    d50: _interpolateDx(cdfMm, cdfPct, 50),
    d84: _interpolateDx(cdfMm, cdfPct, 84),
  };
}

function _interpolateDx(mmVals, pctVals, pct) {
  for (let i = 0; i < pctVals.length; i++) {
    if (pctVals[i] >= pct) {
      if (i === 0) return mmVals[0].toFixed(DX_PRECISION);
      if (pctVals[i] === pctVals[i - 1]) return mmVals[i].toFixed(DX_PRECISION);
      const logLo = Math.log(mmVals[i - 1]);
      const logHi = Math.log(mmVals[i]);
      const f = (pct - pctVals[i - 1]) / (pctVals[i] - pctVals[i - 1]);
      return Math.exp(logLo + f * (logHi - logLo)).toFixed(DX_PRECISION);
    }
  }
  return mmVals[mmVals.length - 1].toFixed(DX_PRECISION);
}

function _generateBoundaries(interval) {
  const boundaries = [];
  const eps = 1e-9;
  const phiList = [];
  for (let phi = 1.0; phi >= -8.0 - eps; phi -= interval) {
    phiList.push(parseFloat(phi.toFixed(4)));
  }

  function _toBool(value) {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes';
    }
    if (typeof value === 'number') return value === 1;
    return false;
  }
  const mmList = phiList.map(p => Math.pow(2, -p));

  // Finest bin
  boundaries.push({ key: 'finest', upperMm: mmList[0] });

  for (let i = 0; i < mmList.length - 1; i++) {
    const hi = mmList[i + 1];
    // Key: always 3 decimal places (matches bins.js mmToKey behaviour)
    const key = parseFloat(hi.toPrecision(6)).toFixed(3);
    boundaries.push({ key, upperMm: hi });
  }

  // Coarsest bin
  boundaries.push({ key: 'coarsest', upperMm: Infinity });

  return boundaries;
}
