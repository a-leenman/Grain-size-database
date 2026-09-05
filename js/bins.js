/**
 * Phi size-class bin definitions.
 *
 * Each bin object has:
 *   key        {string}  – unique identifier used as the property name in
 *                          sample.counts  (e.g. "finest", "2.0", "coarsest")
 *   label      {string}  – human-readable size range  (e.g. "1.0 – 2.0 mm")
 *   phiLabel   {string}  – phi range string           (e.g. "-1 – 0 φ")
 *   lowerMm    {number}  – lower class boundary in mm (0 for finest bin)
 *   upperMm    {number}  – upper class boundary in mm (Infinity for coarsest)
 *   midpointMm {number}  – geometric-mean midpoint    (used for plotting)
 *
 * Relationship between mm and phi:
 *   phi = −log₂(D_mm)     →    D_mm = 2^(−phi)
 *
 * Full-phi bins span 1 φ each; half-phi bins span 0.5 φ each.
 * Both sets share the boundary sizes 0.5, 1, 2, 4 … 256 mm; half-phi adds
 * the intermediate boundaries at √2 × adjacent full-phi boundaries.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a millimetre value as a compact string for display.
 * @param {number} mm
 * @returns {string}
 */
function formatMmLabel(mm) {
  if (!isFinite(mm)) return '∞';
  if (mm >= 100) return mm.toFixed(0);
  if (mm >= 10)  return mm.toFixed(1);
  if (mm >= 1)   return mm.toFixed(2);
  return mm.toFixed(3);
}

/**
 * Round a millimetre boundary to a consistent 3-decimal-place string key.
 * Using a fixed number of decimal places makes keys unambiguous across all
 * magnitude ranges (0.5 mm through 256 mm) and easy to look up.
 * @param {number} mm
 * @returns {string}
 */
function mmToKey(mm) {
  if (!isFinite(mm)) return 'coarsest';
  return parseFloat(mm.toPrecision(6)).toFixed(3);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the array of size-class bins for a given phi interval.
 *
 * @param {boolean} halfPhi  true → 0.5 φ intervals; false → 1 φ intervals
 * @returns {Array<Object>}  ordered from finest to coarsest
 */
function generateBins(halfPhi) {
  const interval = halfPhi ? 0.5 : 1.0;
  const bins = [];

  // Build phi boundary array from +1 φ (= 0.5 mm) down to -8 φ (= 256 mm),
  // stepping by `interval`.
  const phiBoundaries = [];
  const eps = 1e-9; // floating-point guard
  for (let phi = 1.0; phi >= -8.0 - eps; phi -= interval) {
    phiBoundaries.push(parseFloat(phi.toFixed(4)));
  }
  // Convert to mm (D = 2^(−phi)).
  const mmBoundaries = phiBoundaries.map(p => Math.pow(2, -p));

  // ── Finest bin: everything finer than the smallest sieve (0.5 mm) ─────────
  bins.push({
    key:        'finest',
    label:      `< ${formatMmLabel(mmBoundaries[0])} mm`,
    phiLabel:   `> ${phiBoundaries[0].toFixed(1)} φ`,
    lowerMm:    0,
    upperMm:    mmBoundaries[0],
    midpointMm: mmBoundaries[0] / 2,
  });

  // ── Intermediate bins ──────────────────────────────────────────────────────
  for (let i = 0; i < mmBoundaries.length - 1; i++) {
    const lo    = mmBoundaries[i];
    const hi    = mmBoundaries[i + 1];
    const phiHi = phiBoundaries[i];       // finer phi (higher number)
    const phiLo = phiBoundaries[i + 1];   // coarser phi (lower number)

    bins.push({
      key:        mmToKey(hi),
      label:      `${formatMmLabel(lo)} – ${formatMmLabel(hi)} mm`,
      phiLabel:   `${phiLo.toFixed(1)} – ${phiHi.toFixed(1)} φ`,
      lowerMm:    lo,
      upperMm:    hi,
      midpointMm: Math.sqrt(lo * hi),  // geometric mean
    });
  }

  // ── Coarsest bin: everything coarser than the largest sieve (256 mm) ───────
  const lastMm  = mmBoundaries[mmBoundaries.length - 1];
  const lastPhi = phiBoundaries[phiBoundaries.length - 1];
  bins.push({
    key:        'coarsest',
    label:      `> ${formatMmLabel(lastMm)} mm`,
    phiLabel:   `< ${lastPhi.toFixed(1)} φ`,
    lowerMm:    lastMm,
    upperMm:    Infinity,
    midpointMm: lastMm * 2,
  });

  return bins;
}

/** Pre-built bin arrays (generated once on load). */
const BINS_FULL = generateBins(false);
const BINS_HALF = generateBins(true);

/**
 * Return the correct bin array for a sample.
 * @param {Object} sample  sample object with a phi_interval property
 * @returns {Array<Object>}
 */
function getBinsForSample(sample) {
  return sample.phi_interval === 'half' ? BINS_HALF : BINS_FULL;
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

/**
 * Compute a cumulative distribution (% finer than) from a sample's counts.
 *
 * @param {Object} sample  sample object
 * @returns {{ mmValues: number[], pctFiner: number[] }}
 *   mmValues  – upper class boundary in mm for each plotted point
 *   pctFiner  – cumulative % finer at each upper boundary
 */
function computeCDF(sample) {
  const bins   = getBinsForSample(sample);
  const counts = sample.counts || {};

  // Sum over all bins to get total count.
  let total = 0;
  bins.forEach(b => { total += (counts[b.key] || 0); });

  if (total === 0) return { mmValues: [], pctFiner: [] };

  const mmValues  = [];
  const pctFiner  = [];
  let cumulative  = 0;

  bins.forEach(b => {
    cumulative += (counts[b.key] || 0);
    const pct = (cumulative / total) * 100;

    // Use upper boundary for plotting; skip Infinity for the coarsest bin
    // (CDF reaches 100 % at the last finite boundary instead).
    if (isFinite(b.upperMm)) {
      mmValues.push(b.upperMm);
      pctFiner.push(parseFloat(pct.toFixed(2)));
    } else {
      // Still record 100 % at a representative "coarse" position
      mmValues.push(b.lowerMm * 2);
      pctFiner.push(100);
    }
  });

  return { mmValues, pctFiner };
}

/**
 * Interpolate Dx percentile from CDF arrays.
 * @param {{ mmValues: number[], pctFiner: number[] }} cdf
 * @param {number} pct  e.g. 50 for D50
 * @returns {number|null}
 */
function getDx(cdf, pct) {
  const { mmValues, pctFiner } = cdf;
  if (!mmValues.length) return null;
  const precision = (typeof CONFIG !== 'undefined' && CONFIG.DX_PRECISION != null)
    ? CONFIG.DX_PRECISION : 2;

  for (let i = 0; i < pctFiner.length; i++) {
    if (pctFiner[i] >= pct) {
      if (i === 0) return parseFloat(mmValues[0].toFixed(precision));
      if (pctFiner[i] === pctFiner[i - 1]) return parseFloat(mmValues[i].toFixed(precision));
      // Linear interpolation in log-mm space
      const logLo = Math.log(mmValues[i - 1]);
      const logHi = Math.log(mmValues[i]);
      const f = (pct - pctFiner[i - 1]) / (pctFiner[i] - pctFiner[i - 1]);
      return parseFloat(Math.exp(logLo + f * (logHi - logLo)).toFixed(precision));
    }
  }
  return parseFloat(mmValues[mmValues.length - 1].toFixed(precision));
}
