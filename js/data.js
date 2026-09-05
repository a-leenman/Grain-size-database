/**
 * Data layer – loading, saving, and caching grain-size samples.
 *
 * Priority order for reading data:
 *   1. CONFIG.API_URL  (Google Apps Script or custom REST API)
 *   2. CONFIG.DATA_URL (data/samples.json served statically)
 *   3. localStorage    (browser-local storage, used in demo / offline mode)
 *
 * When submitting a new sample:
 *   • If CONFIG.API_URL is set → POST to the API endpoint.
 *   • Otherwise               → save to localStorage only.
 */

const LS_KEY = 'grainSizeDB_samples';

// In-memory cache so the rest of the app can call getSamples() synchronously
// after the initial load.
let _cache = null;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load all samples (async).  Populates the in-memory cache.
 * @returns {Promise<Array>}
 */
async function loadSamples() {
  // --- 1. Try the configured API endpoint -------------------------------------
  if (CONFIG.API_URL) {
    try {
      const url = `${CONFIG.API_URL}?action=getData`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const remote = Array.isArray(json) ? json : (json.samples || []);
        _cache = _mergeWithLocal(remote);
        return _cache;
      }
    } catch (err) {
      console.warn('API fetch failed, falling back to static file:', err);
    }
  }

  // --- 2. Try the static JSON file -------------------------------------------
  try {
    const res = await fetch(CONFIG.DATA_URL);
    if (res.ok) {
      const json = await res.json();
      const remote = Array.isArray(json) ? json : (json.samples || []);
      _cache = _mergeWithLocal(remote);
      return _cache;
    }
  } catch (err) {
    console.warn('Static JSON fetch failed, using localStorage only:', err);
  }

  // --- 3. Fall back to localStorage only -------------------------------------
  _cache = _loadLocal();
  return _cache;
}

/**
 * Return the cached sample list (synchronous, after loadSamples() has been called).
 * @returns {Array}
 */
function getSamples() {
  return _cache || [];
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/**
 * Save a new sample.
 *
 * Always saves to localStorage so the data is immediately visible.
 * If CONFIG.API_URL is set, also POSTs to the remote endpoint.
 *
 * @param {Object} sample  validated sample object
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function saveSample(sample) {
  // Assign a stable id if missing.
  if (!sample.id) {
    sample.id = _generateId();
  }
  sample.timestamp = sample.timestamp || new Date().toISOString();

  // Always persist locally.
  _saveLocal(sample);
  if (_cache) _cache.push(sample);

  // If an API is configured, also send to the backend.
  if (CONFIG.API_URL) {
    try {
      const res = await fetch(CONFIG.API_URL, {
        method:  'POST',
        // Google Apps Script requires text/plain to avoid a preflight CORS request
        headers: { 'Content-Type': 'text/plain' },
        body:    JSON.stringify({ action: 'submit', data: sample }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error(json.message || 'Unknown error');
      return { ok: true, message: 'Sample saved to the database.' };
    } catch (err) {
      return {
        ok:      false,
        message: `Saved locally, but the remote upload failed: ${err.message}. ` +
                 `Please export the sample as JSON and share it with the database administrator.`,
      };
    }
  }

  return {
    ok:      true,
    message: 'Sample saved locally (demo mode – no remote backend configured).',
  };
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/**
 * Convert the sample list to a CSV string.
 * One row per sample; metadata columns + D10, D50, D84 statistics.
 * @param {Array} [samples]  defaults to all cached samples
 * @returns {string}
 */
function samplesToCSV(samples) {
  samples = samples || getSamples();
  if (!samples.length) return '';

  const headers = [
    'id', 'timestamp', 'date_collected', 'collector', 'institution',
    'river_name', 'paper_doi', 'lat', 'lng', 'location_description',
    'landform', 'surface_condition', 'phi_interval',
    'total_count', 'D10_mm', 'D50_mm', 'D84_mm',
    'notes', 'photo_urls',
  ];

  const rows = samples.map(s => {
    const cdf     = computeCDF(s);
    const total   = Object.values(s.counts || {}).reduce((a, b) => a + b, 0);
    const d10     = getDx(cdf, 10)  ?? '';
    const d50     = getDx(cdf, 50)  ?? '';
    const d84     = getDx(cdf, 84)  ?? '';
    const photos  = (s.photo_urls || []).join('; ');

    return [
      s.id,
      s.timestamp,
      s.date_collected,
      _csvEsc(s.collector),
      _csvEsc(s.institution),
      _csvEsc(s.river_name),
      _csvEsc(normalizeSampleDOI(s.paper_doi) || ''),
      s.location?.lat ?? '',
      s.location?.lng ?? '',
      _csvEsc(s.location?.description ?? ''),
      s.landform,
      s.surface_condition,
      s.phi_interval,
      total,
      d10, d50, d84,
      _csvEsc(s.notes ?? ''),
      _csvEsc(photos),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Convert the sample list to a pretty-printed JSON string.
 * @param {Array} [samples]  defaults to all cached samples
 * @returns {string}
 */
function samplesToJSON(samples) {
  return JSON.stringify({ samples: samples || getSamples() }, null, 2);
}

/**
 * Trigger a browser file download.
 * @param {string} content   file contents
 * @param {string} filename  suggested filename
 * @param {string} mime      MIME type
 */
function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Return a normalised DOI string (without https://doi.org/ prefix).
 * Returns an empty string if the value does not look like a DOI.
 */
function normalizeSampleDOI(value) {
  if (!value) return '';
  let doi = String(value).trim();
  doi = doi.replace(/^doi:\s*/i, '');
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  doi = doi.replace(/^https?:\/\/doi\.org\//i, '');
  doi = doi.replace(/\s+/g, '');
  if (!/^10\.\S+\/\S+$/i.test(doi)) return '';
  return doi;
}

function getUniqueSampleDois(samples) {
  const out = [];
  const seen = new Set();
  (samples || []).forEach(sample => {
    const doi = normalizeSampleDOI(sample?.paper_doi);
    if (!doi) return;
    const key = doi.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(doi);
    }
  });
  return out;
}

async function downloadBibliographyForSamples(samples, filename = 'grain-size-references.txt') {
  const dois = getUniqueSampleDois(samples);
  if (!dois.length) return { ok: false, reason: 'no-doi' };

  const citations = [];
  for (const doi of dois) {
    citations.push(await _buildCitation(doi));
  }

  const content = [
    'Riverbed Grain Size Database bibliography',
    `Generated: ${new Date().toISOString()}`,
    `Studies: ${dois.length}`,
    '',
    ...citations.map((c, i) => `${i + 1}. ${c}`),
    '',
  ].join('\n');

  downloadFile(content, filename, 'text/plain;charset=utf-8;');
  return { ok: true, count: dois.length };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function _saveLocal(sample) {
  const existing = _loadLocal();
  // Replace if id already exists; otherwise append.
  const idx = existing.findIndex(s => s.id === sample.id);
  if (idx >= 0) existing[idx] = sample;
  else existing.push(sample);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(existing));
  } catch (err) {
    console.warn('localStorage write failed:', err);
  }
}

/**
 * Merge remote samples with locally-stored samples, preferring remote copies
 * when the same id appears in both (in case the remote has been updated).
 */
function _mergeWithLocal(remote) {
  const local = _loadLocal();
  const merged = [...remote];
  const remoteIds = new Set(remote.map(s => s.id));
  local.forEach(s => {
    if (!remoteIds.has(s.id)) merged.push(s);
  });
  return merged;
}

function _generateId() {
  // Simple timestamp + random suffix.
  return `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _csvEsc(str) {
  if (str == null) return '';
  const s = String(str);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }

  async function _buildCitation(doi) {
    try {
      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const message = data?.message || {};

      const authors = _formatCitationAuthors(message.author || []);
      const year = message?.issued?.['date-parts']?.[0]?.[0] || 'n.d.';
      const title = (message.title && message.title[0]) || 'Untitled';
      const journal = (message['container-title'] && message['container-title'][0]) || '';
      const volume = message.volume ? ` ${message.volume}` : '';
      const issue = message.issue ? `(${message.issue})` : '';
      const page = message.page ? `, ${message.page}` : '';

      let citation = `${authors} (${year}). ${title}.`;
      if (journal) citation += ` ${journal}${volume}${issue}${page}.`;
      citation += ` https://doi.org/${doi}`;
      return citation.replace(/\s+/g, ' ').trim();
    } catch {
      return `https://doi.org/${doi}`;
    }
  }

  function _formatCitationAuthors(authors) {
    if (!authors.length) return 'Unknown author';
    const names = authors.map(a => {
      const family = (a.family || '').trim();
      const given = (a.given || '').trim();
      if (family && given) return `${family}, ${given}`;
      return family || given || '';
    }).filter(Boolean);
    if (!names.length) return 'Unknown author';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names[0]} et al.`;
  }
  return s;
}
