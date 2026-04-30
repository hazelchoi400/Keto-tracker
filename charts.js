/* =====================================================
   charts.js — Chart.js setup & rendering
   ===================================================== */

const CHART_COLORS = {
  ink:      '#2d2a26',
  inkSoft:  '#5a544c',
  sage:     '#6b8a6b',
  sageDeep: '#4f6b4f',
  sageSoft: 'rgba(107, 138, 107, 0.15)',
  terra:    '#c87864',
  terraDeep:'#a85a48',
  terraSoft:'rgba(200, 120, 100, 0.15)',
  honey:    '#d4a657',
  line:     '#e3d8c5'
};

let _charts = {};

// Chart.js global defaults
function applyChartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.font.family = "'Manrope', -apple-system, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = CHART_COLORS.inkSoft;
  Chart.defaults.borderColor = CHART_COLORS.line;
  Chart.defaults.plugins.legend.display = false;
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

// Create a daily-grouped time series from records
function dailyAverages(records, valueKey, fromMs, toMs) {
  const days = {};
  for (let t = fromMs; t <= toMs; t += 86400000) {
    const d = new Date(t);
    d.setHours(0,0,0,0);
    days[d.getTime()] = [];
  }
  for (const r of records) {
    const d = new Date(r.timestamp || r.startTime);
    d.setHours(0,0,0,0);
    const key = d.getTime();
    if (days[key] !== undefined) {
      const v = typeof valueKey === 'function' ? valueKey(r) : r[valueKey];
      if (v != null && !isNaN(v)) days[key].push(v);
    }
  }
  const labels = [], data = [];
  Object.keys(days).sort((a, b) => +a - +b).forEach(k => {
    labels.push(formatDayLabel(+k));
    const arr = days[k];
    data.push(arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : null);
  });
  return { labels, data };
}

function dailyCounts(records, fromMs, toMs) {
  const days = {};
  for (let t = fromMs; t <= toMs; t += 86400000) {
    const d = new Date(t);
    d.setHours(0,0,0,0);
    days[d.getTime()] = 0;
  }
  for (const r of records) {
    const d = new Date(r.startTime);
    d.setHours(0,0,0,0);
    if (days[d.getTime()] !== undefined) days[d.getTime()]++;
  }
  const labels = [], data = [];
  Object.keys(days).sort((a, b) => +a - +b).forEach(k => {
    labels.push(formatDayLabel(+k));
    data.push(days[k]);
  });
  return { labels, data };
}

function lineChart(canvasId, labels, data, color, targetBand) {
  applyChartDefaults();
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const datasets = [{
    data,
    borderColor: color,
    backgroundColor: color + '22',
    borderWidth: 2.5,
    tension: 0.35,
    pointRadius: 3,
    pointBackgroundColor: color,
    pointBorderColor: '#fffaf2',
    pointBorderWidth: 1.5,
    pointHoverRadius: 5,
    spanGaps: true,
    fill: true
  }];

  // Target band overlay
  if (targetBand && targetBand.min != null && targetBand.max != null) {
    datasets.push({
      data: data.map(() => targetBand.max),
      borderColor: 'transparent',
      backgroundColor: CHART_COLORS.sageSoft,
      pointRadius: 0,
      fill: { target: { value: targetBand.min }, above: CHART_COLORS.sageSoft, below: 'transparent' }
    });
  }

  _charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { beginAtZero: true, grid: { color: CHART_COLORS.line, drawBorder: false } }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.parsed.y == null ? 'No data' : ctx.parsed.y.toFixed(2)
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

window.KCCharts = {
  COLORS: CHART_COLORS,
  applyChartDefaults,
  dailyAverages, dailyCounts,
  lineChart, barChart,
  computeStats,
  destroyChart
};
