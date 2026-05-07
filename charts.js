/* =====================================================
   charts.js — Chart.js setup & rendering

   v1.1 changes:
   - Plots split into Morning (00:00–11:59) and Evening (12:00–23:59) series
     instead of a single daily mean, so within-day variation is visible.
   - Y-axis no longer clipped by the target-band overlay (was capping at the
     band max, hiding values above it). Scale now auto-fits real data with a
     small headroom, and we ensure the band always fits inside the visible
     range.
   - Target-band datasets excluded from tooltips (used to leak a phantom value
     like "5.00" alongside the real reading).
   ===================================================== */

const CHART_COLORS = {
  ink:      '#2d2a26',
  inkSoft:  '#5a544c',
  // Morning = lighter sage. Evening = deeper sage. Same family for ketone/GKI.
  sage:     '#6b8a6b',
  sageDeep: '#4f6b4f',
  sageSoft: 'rgba(107, 138, 107, 0.15)',
  // Glucose stays honey, but we'll use a deeper variant for evening
  honey:     '#d4a657',
  honeyDeep: '#a37d35',
  honeySoft: 'rgba(212, 166, 87, 0.18)',
  // GKI uses terracotta family
  terra:     '#c87864',
  terraDeep: '#a85a48',
  terraSoft: 'rgba(200, 120, 100, 0.15)',
  line:      '#e3d8c5'
};

// Hour cut-off (inclusive) for "morning". Anything before noon = morning.
const MORNING_END_HOUR = 12;

let _charts = {};

// Chart.js global defaults
function applyChartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.font.family = "'Manrope', -apple-system, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = CHART_COLORS.inkSoft;
  Chart.defaults.borderColor = CHART_COLORS.line;
  // We DO want a legend now — morning vs evening
  Chart.defaults.plugins.legend.display = true;
  Chart.defaults.plugins.legend.position = 'bottom';
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.boxHeight = 12;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.legend.labels.font = { size: 11, weight: 500 };
  Chart.defaults.plugins.tooltip.backgroundColor = CHART_COLORS.ink;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = { weight: 600 };
}

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function formatDayLabel(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

/* =====================================================
   Morning/evening split data builder

   Returns { labels, morning, evening } — two parallel arrays of length
   = number of days in range. Either array entry is the mean of all
   readings for that period that day, or null if none.
   ===================================================== */
function morningEveningSeries(records, valueKey, fromMs, toMs) {
  const days = {}; // dayMs -> { morning: [], evening: [] }
  for (let t = fromMs; t <= toMs; t += 86400000) {
    const d = new Date(t); d.setHours(0,0,0,0);
    days[d.getTime()] = { morning: [], evening: [] };
  }
  for (const r of records) {
    const ts = r.timestamp || r.startTime;
    const d = new Date(ts);
    const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (days[dayKey] === undefined) continue;
    const v = typeof valueKey === 'function' ? valueKey(r) : r[valueKey];
    if (v == null || isNaN(v)) continue;
    const slot = d.getHours() < MORNING_END_HOUR ? 'morning' : 'evening';
    days[dayKey][slot].push(v);
  }
  const labels = [], morning = [], evening = [];
  Object.keys(days).sort((a, b) => +a - +b).forEach(k => {
    labels.push(formatDayLabel(+k));
    const m = days[k].morning;
    const e = days[k].evening;
    morning.push(m.length ? m.reduce((a,b) => a+b, 0) / m.length : null);
    evening.push(e.length ? e.reduce((a,b) => a+b, 0) / e.length : null);
  });
  return { labels, morning, evening };
}

function dailyCounts(records, fromMs, toMs) {
  const days = {};
  for (let t = fromMs; t <= toMs; t += 86400000) {
    const d = new Date(t); d.setHours(0,0,0,0);
    days[d.getTime()] = 0;
  }
  for (const r of records) {
    const d = new Date(r.startTime); d.setHours(0,0,0,0);
    if (days[d.getTime()] !== undefined) days[d.getTime()]++;
  }
  const labels = [], data = [];
  Object.keys(days).sort((a, b) => +a - +b).forEach(k => {
    labels.push(formatDayLabel(+k));
    data.push(days[k]);
  });
  return { labels, data };
}

/* =====================================================
   Compute a y-axis max that always shows real data
   (regardless of where the target band sits)
   ===================================================== */
function suggestedYMax(values, targetBand) {
  const filt = values.filter(v => v != null && !isNaN(v));
  let maxData = filt.length ? Math.max(...filt) : 0;
  let maxBand = targetBand ? targetBand.max : 0;
  let upper = Math.max(maxData, maxBand);
  if (upper <= 0) upper = 1;
  // Add ~15% headroom, round to a nice number
  upper = upper * 1.15;
  if (upper < 1) return Math.ceil(upper * 10) / 10;
  if (upper < 10) return Math.ceil(upper * 2) / 2; // step of 0.5
  return Math.ceil(upper);
}

/* =====================================================
   Morning + evening line chart with optional target band

   `series`        = { labels, morning[], evening[] }
   `colorMorning`  = hex string for morning line
   `colorEvening`  = hex string for evening line
   `targetBand`    = { min, max } | null
   ===================================================== */
function lineChartSplit(canvasId, series, colorMorning, colorEvening, targetBand, opts = {}) {
  applyChartDefaults();
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const datasetMorning = {
    label: opts.morningLabel || 'Morning',
    data: series.morning,
    borderColor: colorMorning,
    backgroundColor: colorMorning + '22',
    borderWidth: 2.5,
    tension: 0.35,
    pointRadius: 3,
    pointBackgroundColor: colorMorning,
    pointBorderColor: '#fffaf2',
    pointBorderWidth: 1.5,
    pointHoverRadius: 5,
    spanGaps: true,
    fill: false,
    order: 1
  };

  const datasetEvening = {
    label: opts.eveningLabel || 'Evening',
    data: series.evening,
    borderColor: colorEvening,
    backgroundColor: colorEvening + '22',
    borderWidth: 2.5,
    borderDash: [5, 4],
    tension: 0.35,
    pointRadius: 3,
    pointBackgroundColor: colorEvening,
    pointBorderColor: '#fffaf2',
    pointBorderWidth: 1.5,
    pointHoverRadius: 5,
    spanGaps: true,
    fill: false,
    order: 1
  };

  const datasets = [datasetMorning, datasetEvening];

  // Target band: drawn as a filled region between two flat lines, rendered
  // BEHIND the data and EXCLUDED from tooltips/legend.
  if (targetBand && targetBand.min != null && targetBand.max != null) {
    const minLine = series.labels.map(() => targetBand.min);
    const maxLine = series.labels.map(() => targetBand.max);
    datasets.push({
      label: '_targetMax',
      data: maxLine,
      borderColor: 'transparent',
      backgroundColor: CHART_COLORS.sageSoft,
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: '+1', // fill toward the next dataset (the min line)
      tension: 0,
      order: 99 // higher = drawn first, behind data
    });
    datasets.push({
      label: '_targetMin',
      data: minLine,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      tension: 0,
      order: 99
    });
  }

  // Combine all real values to compute a proper y-max
  const allVals = [...series.morning, ...series.evening];
  const yMax = suggestedYMax(allVals, targetBand);

  _charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels: series.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: {
          beginAtZero: true,
          suggestedMax: yMax,
          grid: { color: CHART_COLORS.line, drawBorder: false }
        }
      },
      plugins: {
        legend: {
          labels: {
            // Hide the target-band entries from the legend
            filter: (item) => !item.text || !item.text.startsWith('_target')
          }
        },
        tooltip: {
          // Hide target-band entries from the tooltip
          filter: (tooltipItem) => {
            const label = tooltipItem.dataset.label || '';
            return !label.startsWith('_target');
          },
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || '';
              if (ctx.parsed.y == null) return `${label}: —`;
              return `${label}: ${ctx.parsed.y.toFixed(2)}`;
            }
          }
        }
      }
    }
  });
}

function barChart(canvasId, labels, data, color) {
  applyChartDefaults();
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Seizures',
        data,
        backgroundColor: color,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 28
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 }, grid: { color: CHART_COLORS.line } }
      }
    }
  });
}

function computeStats(values) {
  const filt = values.filter(v => v != null && !isNaN(v));
  if (!filt.length) return { min: '—', max: '—', mean: '—', median: '—', count: 0 };
  const sorted = [...filt].sort((a,b) => a - b);
  const sum = filt.reduce((a,b) => a+b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  return {
    min: sorted[0].toFixed(1),
    max: sorted[sorted.length - 1].toFixed(1),
    mean: (sum / filt.length).toFixed(1),
    median: median.toFixed(1),
    count: filt.length
  };
}

/* =====================================================
   Exports
   ===================================================== */

window.KCCharts = {
  COLORS: CHART_COLORS,
  MORNING_END_HOUR,
  applyChartDefaults,
  morningEveningSeries,
  dailyCounts,
  lineChartSplit,
  barChart,
  computeStats,
  destroyChart,
  suggestedYMax
};
