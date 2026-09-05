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
 * 7. (Optional) Export a copy from Google Sheets when you need to share a
 *    snapshot in OneDrive.
 *
 * ENDPOINTS
 * ─────────
 * GET  ?action=getData            → returns all samples as JSON
 * POST body (text/plain JSON)     → { action: 'submit', data: <sample> }
 */

// ── Configuration ──────────────────────────────────────────────────────────
const SHEET_ID    = 'YOUR_GOOGLE_SHEET_ID_HERE';
const SHEET_NAME  = 'Samples';   // Tab name inside the Google Sheet
const ADMIN_QC_TOKEN = 'CHANGE_ME_ADMIN_QC_TOKEN';
// Decimal places used when writing Dx percentile statistics to the sheet.
// Must match CONFIG.DX_PRECISION in js/config.js.
const DX_PRECISION = 2;

// ── Column headers written to the sheet ────────────────────────────────────
const HEADERS = [
  'id', 'timestamp', 'date_collected', 'collector', 'institution',
  'contributor_email', 'contributor_id', 'allow_public_acknowledgement', 'river_name', 'paper_doi', 'lat', 'lng', 'location_description',
  'landform', 'surface_condition', 'min_opening_mm', 'phi_interval',
  'total_count', 'D10_mm', 'D50_mm', 'D84_mm', 'qc_checked', 'qc_checked_at', 'qc_checked_by',
  'notes', 'photo_urls',
  'counts_json',   // raw JSON blob of the full counts object
  'percentages_json',
];

// ── CORS helper ─────────────────────────────────────────────────────────────
function _corsResponse(data) {
  const output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

function _normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function _contributorIdFromEmail(email) {
  const value = _normalizeEmail(email);
  if (!value) return '';
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) + value.charCodeAt(i);
    hash &= 0xffffffff;
  }
  return 'contrib-' + (hash >>> 0).toString(16);
}

function _toPublicSample(sample) {
  const out = Object.assign({}, sample);
  if (!_toBool(out.allow_public_acknowledgement)) {
    out.collector = '';
    out.institution = '';
    out.contributor_id = '';
  }
  delete out.contributor_email;
  return out;
}

function _isValidAdminToken(token) {
  return !!ADMIN_QC_TOKEN && token === ADMIN_QC_TOKEN;
}

function _updateSampleQcStatus(sampleId, qcChecked, qcCheckedBy) {
  const sheet = _getSheet();
  const dataRows = Math.max(0, sheet.getLastRow() - 1);
  if (dataRows === 0) throw new Error('No samples found');
  const idValues = sheet.getRange(2, 1, dataRows, 1).getValues();
  const rowIndex = idValues.findIndex(r => String(r[0]) === String(sampleId));
  if (rowIndex < 0) throw new Error('Sample not found');
  const rowNumber = rowIndex + 2;
  const qcCheckedAt = qcChecked ? new Date().toISOString() : '';
  const qcCheckedByVal = qcChecked ? String(qcCheckedBy || 'Admin') : '';

  const qcCheckedCol = HEADERS.indexOf('qc_checked') + 1;
  const qcCheckedAtCol = HEADERS.indexOf('qc_checked_at') + 1;
  const qcCheckedByCol = HEADERS.indexOf('qc_checked_by') + 1;
  sheet.getRange(rowNumber, qcCheckedCol).setValue(_toBool(qcChecked));
  sheet.getRange(rowNumber, qcCheckedAtCol).setValue(qcCheckedAt);
  sheet.getRange(rowNumber, qcCheckedByCol).setValue(qcCheckedByVal);
  return { qc_checked_at: qcCheckedAt };
}

function _isValidSample(sample) {
  const requiredText = ['id', 'river_name', 'date_collected', 'landform', 'surface_condition', 'phi_interval'];
  for (let i = 0; i < requiredText.length; i++) {
    const key = requiredText[i];
    if (!String(sample[key] || '').trim()) return false;
  }
  const lat = sample.location && sample.location.lat;
  const lng = sample.location && sample.location.lng;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return false;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return false;
  const email = _normalizeEmail(sample.contributor_email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  if (!sample.counts || typeof sample.counts !== 'object') return false;
  const minOpening = Number(sample.min_opening_mm);
  if (!Number.isFinite(minOpening) || minOpening <= 0) return false;
  const total = Object.keys(sample.counts).reduce((sum, k) => sum + (parseInt(sample.counts[k], 10) || 0), 0);
  return total > 0;
}

function _parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// ── GET handler ─────────────────────────────────────────────────────────────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'getData';

  if (action === 'getData') {
    try {
      const samples = _getAllSamples().map(_toPublicSample);
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
      if (payload.action === 'authQC') {
        if (!_isValidAdminToken(payload.token)) {
          return _corsResponse({ status: 'error', message: 'Unauthorized admin token' });
        }
        return _corsResponse({ status: 'ok', message: 'Authorized' });
      }
      if (payload.action === 'updateQC') {
        if (!_isValidAdminToken(payload.token)) {
          return _corsResponse({ status: 'error', message: 'Unauthorized QC update' });
        }
        const qcResult = _updateSampleQcStatus(payload.sample_id, _toBool(payload.qc_checked), payload.qc_checked_by || 'Admin');
        return _corsResponse({
          status: 'ok',
          message: 'QC flag updated.',
          qc_checked_at: qcResult.qc_checked_at,
        });
      }
      return _corsResponse({ status: 'error', message: 'Unknown action' });
    }

    const sample = payload.data;
    if (!sample || !sample.id) {
      return _corsResponse({ status: 'error', message: 'Invalid sample data' });
    }
    if (!_isValidSample(sample)) {
      return _corsResponse({ status: 'error', message: 'Sample failed validation checks' });
    }

    _appendSample(sample);
    return _corsResponse({ status: 'ok', message: 'Sample saved.' });

  } catch (err) {
    return _corsResponse({ status: 'error', message: err.message });
  }
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
    _normalizeEmail(sample.contributor_email),
    sample.contributor_id || _contributorIdFromEmail(sample.contributor_email),
    _toBool(sample.allow_public_acknowledgement),
    sample.river_name || '',
    sample.paper_doi || '',
    Number.isFinite(lat) ? lat : '',
    Number.isFinite(lng) ? lng : '',
    (sample.location && sample.location.description) || '',
    sample.landform || '',
    sample.surface_condition || '',
    Number(sample.min_opening_mm) || 0.5,
    sample.phi_interval || 'full',
    stats.total,
    stats.d10 || '',
    stats.d50 || '',
    stats.d84 || '',
    _toBool(sample.qc_checked),
    sample.qc_checked_at || '',
    sample.qc_checked_by || '',
    sample.notes || '',
    (sample.photo_urls || []).join('; '),
    JSON.stringify(sample.counts || {}),
    JSON.stringify(sample.percentages || {}),
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
      contributor_email: obj.contributor_email || '',
      contributor_id:    obj.contributor_id || _contributorIdFromEmail(obj.contributor_email),
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
      min_opening_mm:    parseFloat(obj.min_opening_mm) || 0.5,
      phi_interval:      obj.phi_interval || 'full',
      qc_checked:        _toBool(obj.qc_checked),
      qc_checked_at:     obj.qc_checked_at || '',
      qc_checked_by:     obj.qc_checked_by || '',
      counts,
      percentages:       _parseJsonObject(obj.percentages_json),
      notes:             obj.notes || '',
      photo_urls:        obj.photo_urls ? obj.photo_urls.split('; ').filter(Boolean) : [],
    };
  });
}

// ── Simple statistics (mirrors getDx in js/bins.js) ──────────────────────────

function _computeStats(sample) {
  const interval = sample.phi_interval === 'half' ? 0.5 : 1.0;
  const minOpeningMm = Number(sample.min_opening_mm) || 0.5;
  const boundaries = _generateBoundaries(interval, minOpeningMm);

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

function _generateBoundaries(interval, minOpeningMm) {
  const boundaries = [];
  const eps = 1e-9;
  const phiList = [];
  const minMm = Number.isFinite(minOpeningMm) && minOpeningMm > 0 ? minOpeningMm : 0.5;
  const startPhi = -Math.log(minMm) / Math.log(2);
  for (let phi = startPhi; phi >= -8.0 - eps; phi -= interval) {
    phiList.push(parseFloat(phi.toFixed(4)));
  }
  if (!phiList.length || phiList[phiList.length - 1] > -8.0 + eps) {
    phiList.push(-8.0);
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

function _toBool(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}
