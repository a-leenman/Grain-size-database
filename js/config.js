/**
 * Configuration for the Riverbed Grain Size Database.
 *
 * To enable data persistence, set API_URL to your deployed Google Apps Script
 * web-app URL (see apps-script/Code.gs for the backend code).
 *
 * Without an API_URL the site operates in "demo mode": submitted samples are
 * stored in browser localStorage and merged into the displayed dataset locally.
 */
const CONFIG = {
  // -------------------------------------------------------------------------
  // Backend endpoint (Google Apps Script web-app or compatible REST API).
  // Set to null to use localStorage only (demo / offline mode).
  // Example: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec'
  // -------------------------------------------------------------------------
  API_URL: null,

  // -------------------------------------------------------------------------
  // Path (or URL) to the JSON file containing pre-loaded sample data.
  // On GitHub Pages this resolves to data/samples.json in the same repo.
  // -------------------------------------------------------------------------
  DATA_URL: 'data/samples.json',

  // -------------------------------------------------------------------------
  // Leaflet map defaults
  // -------------------------------------------------------------------------
  MAP_CENTER: [54.0, -2.0],   // UK / Western Europe
  MAP_ZOOM:   5,

  // Minimum zoom applied when the user types coordinates on the submit page.
  COORD_INPUT_MIN_ZOOM: 10,

  // -------------------------------------------------------------------------
  // Marker colour scale (D50 in mm → hue, using a simple blue→red ramp)
  // -------------------------------------------------------------------------
  MARKER_MIN_MM: 2,     // fine gravel  → blue
  MARKER_MAX_MM: 128,   // small boulder → red

  // -------------------------------------------------------------------------
  // CDF chart colours
  // -------------------------------------------------------------------------
  CDF_LINE_COLOR:   '#1a6fa8',
  CDF_FILL_COLOR:   'rgba(26,111,168,0.12)',
  CDF_POINT_COLOR:  '#1a6fa8',

  // -------------------------------------------------------------------------
  // Decimal places used when reporting Dx percentile statistics (mm).
  // -------------------------------------------------------------------------
  DX_PRECISION: 2,
};
