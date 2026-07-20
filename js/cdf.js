/**
 * CDF chart rendering using Chart.js.
 *
 * Provides:
 *   renderCDF(canvasEl, sample, options)  – draw or update a CDF chart
 *   destroyChart(canvasEl)               – destroy the chart on a canvas
 */

// Map from canvas element → Chart instance, so we can update without leaking.
const _chartInstances = new WeakMap();

/**
 * Render (or update) a CDF chart on the given canvas element.
 *
 * @param {HTMLCanvasElement} canvasEl   target <canvas>
 * @param {Object}            sample     sample object (must have counts & phi_interval)
 * @param {Object}            [options]
 * @param {boolean}           [options.mini=false]  true → hide axes/legend (popup mode)
 * @param {string}            [options.title]       optional chart title
 */
function renderCDF(canvasEl, sample, options = {}) {
  const { mmValues, pctFiner } = computeCDF(sample);

  // Destroy existing chart if present.
  if (_chartInstances.has(canvasEl)) {
    _chartInstances.get(canvasEl).destroy();
    _chartInstances.delete(canvasEl);
  }

  if (!mmValues.length) {
    // Nothing to plot – clear canvas.
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    return;
  }

  const mini    = !!options.mini;
  const title   = options.title || '';
  const lineCol = CONFIG.CDF_LINE_COLOR;
  const fillCol = CONFIG.CDF_FILL_COLOR;

  const chart = new Chart(canvasEl, {
    type: 'line',
    data: {
      labels: mmValues,
      datasets: [{
        label:            '% finer than',
        data:             pctFiner,
        borderColor:      lineCol,
        backgroundColor:  fillCol,
        fill:             true,
        tension:          0.3,
        pointRadius:      mini ? 2 : 4,
        pointHoverRadius: mini ? 4 : 6,
        borderWidth:      mini ? 1.5 : 2,
        pointBackgroundColor: CONFIG.CDF_POINT_COLOR,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: mini ? 0 : 400 },
      plugins: {
        legend: { display: !mini },
        title:  { display: !!title && !mini, text: title },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].parsed.x} mm`,
            label: (item)  => `% finer than: ${item.parsed.y.toFixed(1)} %`,
          },
        },
      },
      scales: {
        x: {
          type:    'logarithmic',
          title:   {
            display: !mini,
            text:    'Grain size (mm)',
            font:    { size: 12 },
          },
          min: 0.1,
          max: 1024,
          ticks: {
            display: !mini,
            maxTicksLimit: 8,
            callback: (val) => {
              const v = Number(val);
              // Only label "nice" round values on the log scale
              const nice = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
              return nice.includes(v) ? v : '';
            },
          },
          grid: { display: !mini },
        },
        y: {
          title:   {
            display: !mini,
            text:    '% finer than',
            font:    { size: 12 },
          },
          min:  0,
          max:  100,
          ticks: {
            display: !mini,
            stepSize: 25,
            callback: (val) => `${val}%`,
          },
          grid: { display: !mini },
        },
      },
    },
  });

  _chartInstances.set(canvasEl, chart);
}

/**
 * Destroy the Chart.js instance on the given canvas element (if any).
 * Call this when removing a popup to prevent memory leaks.
 * @param {HTMLCanvasElement} canvasEl
 */
function destroyChart(canvasEl) {
  if (_chartInstances.has(canvasEl)) {
    _chartInstances.get(canvasEl).destroy();
    _chartInstances.delete(canvasEl);
  }
}
