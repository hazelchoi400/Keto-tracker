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

  // Seizure markers along the baseline (optional)
  if (opts.markers && opts.markers.length) {
    const points = opts.markers.map(m => ({ x: series.labels[m.index], y: 0 }));
    datasets.push({
      label: '_seizureMarkers',
      data: points,
      type: 'scatter',
      borderColor: 'transparent',
      backgroundColor: CHART_COLORS.terraDeep,
      pointStyle: 'circle',
      pointRadius: 4,
      pointHoverRadius: 5,
      pointBorderColor: '#fffaf2',
      pointBorderWidth: 1,
      showLine: false,
      order: 0
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
            // Hide internal-only datasets from the legend
            filter: (item) => !item.text || !item.text.startsWith('_')
          }
        },
        tooltip: {
          // Hide internal-only datasets from the tooltip
          filter: (tooltipItem) => {
            const label = tooltipItem.dataset.label || '';
            return !label.startsWith('_');
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

/**
 * Hour-of-day histogram (0–23). Used for the descriptive
 * "Seizures by hour of day" chart on Trends.
 */
function hourHistogramChart(canvasId, data, color) {
  applyChartDefaults();
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const labels = data.map((_, h) => String(h));
  // Show only major ticks: 0, 6, 12, 18 — keeps the axis legible
  const majorTicks = new Set([0, 6, 12, 18]);
  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Seizures',
        data,
        backgroundColor: color,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 14
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].label}:00`,
            label: (item) => `${item.parsed.y} seizure${item.parsed.y === 1 ? '' : 's'}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: false,
            callback: function(_, index) {
              return majorTicks.has(index) ? `${index}:00` : '';
            }
          }
        },
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
   Combined daily series (single line, no AM/PM split)

   Returns { labels, data } — data[i] is the mean of all readings on day i,
   or null if there were none.
   ===================================================== */
function dailySeries(records, valueKey, fromMs, toMs) {
  const days = {};
  for (let t = fromMs; t <= toMs; t += 86400000) {
    const d = new Date(t); d.setHours(0,0,0,0);
    days[d.getTime()] = [];
  }
  for (const r of records) {
    const ts = r.timestamp || r.startTime;
    const d = new Date(ts);
    const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (days[dayKey] === undefined) continue;
    const v = typeof valueKey === 'function' ? valueKey(r) : r[valueKey];
    if (v == null || isNaN(v)) continue;
    days[dayKey].push(v);
  }
  const labels = [], data = [];
  Object.keys(days).sort((a, b) => +a - +b).forEach(k => {
    labels.push(formatDayLabel(+k));
    const arr = days[k];
    data.push(arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : null);
  });
  return { labels, data };
}

/* =====================================================
   Seizure-day index: which days (by index in labels[]) had >=1 seizure.

   Returns an array of { index, count } objects.
   Useful for plotting markers along the x-axis of another chart whose
   labels[] was produced by dailySeries / morningEveningSeries (same range).
   ===================================================== */
function seizureDayMarkers(seizures, fromMs, toMs) {
  const days = {};
  let i = 0;
  for (let t = fromMs; t <= toMs; t += 86400000) {
    const d = new Date(t); d.setHours(0,0,0,0);
    days[d.getTime()] = { index: i++, count: 0 };
  }
  for (const s of seizures) {
    const d = new Date(s.startTime); d.setHours(0,0,0,0);
    if (days[d.getTime()] !== undefined) days[d.getTime()].count++;
  }
  return Object.values(days).filter(d => d.count > 0);
}

/* =====================================================
   Seizures by hour of day (24-hour histogram)

   Returns { labels: ['0','1',…,'23'], data: [counts] }
   ===================================================== */
function seizuresByHour(seizures) {
  const counts = new Array(24).fill(0);
  for (const s of seizures) {
    const h = new Date(s.startTime).getHours();
    counts[h]++;
  }
  const labels = counts.map((_, h) => String(h));
  return { labels, data: counts };
}

/* =====================================================
   Weekly heatmap data

   Builds an array of weeks. Each week is an array of 7 day cells.
   The grid is week-aligned (Mon → Sun) so columns are days-of-week.
   The first week's leading days and the last week's trailing days are
   "out of range" cells so the grid stays rectangular.

   Returns:
     {
       weeks: [
         { weekStartMs, days: [{ ms, inRange, count }] x7 }, // length 7
         ...
       ],
       maxCount,           // max single-day count, for opacity scaling
       totalSeizures       // total seizures within range
     }
   ===================================================== */
function weeklyHeatmap(seizures, fromMs, toMs) {
  // Normalise range to whole local-day boundaries
  const start = new Date(fromMs); start.setHours(0,0,0,0);
  const end = new Date(toMs); end.setHours(23,59,59,999);

  // Find Monday of the week containing `start`.
  // getDay(): 0=Sun..6=Sat. We want Mon=0..Sun=6.
  const dayMonIdx = (d) => (d.getDay() + 6) % 7;
  const firstWeekMonday = new Date(start);
  firstWeekMonday.setDate(start.getDate() - dayMonIdx(start));
  firstWeekMonday.setHours(0,0,0,0);

  // Bucket seizures by local-day timestamp
  const dayCounts = {};
  for (const s of seizures) {
    const d = new Date(s.startTime); d.setHours(0,0,0,0);
    const key = d.getTime();
    dayCounts[key] = (dayCounts[key] || 0) + 1;
  }

  const weeks = [];
  let maxCount = 0;
  let totalSeizures = 0;
  let cursor = new Date(firstWeekMonday);

  while (cursor.getTime() <= end.getTime()) {
    const weekStartMs = cursor.getTime();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(weekStartMs + i * 86400000);
      const inRange = dayDate.getTime() >= start.getTime() && dayDate.getTime() <= end.getTime();
      const count = inRange ? (dayCounts[dayDate.getTime()] || 0) : 0;
      if (inRange) {
        if (count > maxCount) maxCount = count;
        totalSeizures += count;
      }
      days.push({ ms: dayDate.getTime(), inRange, count });
    }
    weeks.push({ weekStartMs, days });
    cursor = new Date(cursor.getTime() + 7 * 86400000);
  }

  return { weeks, maxCount, totalSeizures };
}

/* =====================================================
   Triggers frequency tally

   Each seizure record may have a triggers[] array. Counts trigger
   instances (not seizures), since a single seizure can list multiple.
   Also reports how many seizures had no trigger logged.

   Returns:
     {
       items: [{ label, count }, ...]   // sorted desc, includes "No trigger noted"
       totalSeizures,
       seizuresWithTrigger
     }
   ===================================================== */
function triggerCounts(seizures) {
  const tally = {};
  let seizuresWithTrigger = 0;
  for (const s of seizures) {
    const triggers = (s.triggers || []).filter(Boolean);
    if (triggers.length) {
      seizuresWithTrigger++;
      for (const t of triggers) {
        const label = String(t).replace(/-/g, ' ');
        tally[label] = (tally[label] || 0) + 1;
      }
    }
  }
  const noTriggerCount = seizures.length - seizuresWithTrigger;
  // Capitalise first letter of each label for display
  const items = Object.entries(tally)
    .map(([label, count]) => ({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      count
    }))
    .sort((a, b) => b.count - a.count);
  // Always include "No trigger noted" at the end so denominator is clear
  if (noTriggerCount > 0) {
    items.push({ label: 'No trigger noted', count: noTriggerCount });
  }
  return {
    items,
    totalSeizures: seizures.length,
    seizuresWithTrigger
  };
}

/* =====================================================
   Horizontal bar chart (used by triggers tally)
   ===================================================== */
function horizontalBarChart(canvasId, labels, data, color) {
  applyChartDefaults();
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Count',
        data,
        backgroundColor: color,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 22
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: CHART_COLORS.line }
        },
        y: {
          grid: { display: false }
        }
      }
    }
  });
}

/* =====================================================
   Combined-mode line chart (single series + optional band + optional
   seizure markers along the x-axis baseline)

   `series` = { labels, data } from dailySeries
   `color`  = main line colour
   `targetBand` = { min, max } | null
   `markers` = [{ index, count }] | null   — terracotta dots along baseline
   ===================================================== */
function lineChartCombined(canvasId, series, color, targetBand, markers, opts = {}) {
  applyChartDefaults();
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const dataset = {
    label: opts.label || 'Reading',
    data: series.data,
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
    fill: true,
    order: 1
  };

  const datasets = [dataset];

  if (targetBand && targetBand.min != null && targetBand.max != null) {
    datasets.push({
      label: '_targetMax',
      data: series.labels.map(() => targetBand.max),
      borderColor: 'transparent',
      backgroundColor: CHART_COLORS.sageSoft,
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: '+1',
      tension: 0,
      order: 99
    });
    datasets.push({
      label: '_targetMin',
      data: series.labels.map(() => targetBand.min),
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      tension: 0,
      order: 99
    });
  }

  // Seizure markers — terracotta dots pinned at y=0, one per affected day.
  // Using {x, y} point format on the same `labels` x-axis as the main data.
  if (markers && markers.length) {
    const points = markers.map(m => ({ x: series.labels[m.index], y: 0 }));
    datasets.push({
      label: '_seizureMarkers',
      data: points,
      type: 'scatter',
      borderColor: 'transparent',
      backgroundColor: CHART_COLORS.terraDeep,
      pointStyle: 'circle',
      pointRadius: 4,
      pointHoverRadius: 5,
      pointBorderColor: '#fffaf2',
      pointBorderWidth: 1,
      showLine: false,
      order: 0
    });
  }

  const yMax = suggestedYMax(series.data, targetBand);

  _charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels: series.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { beginAtZero: true, suggestedMax: yMax, grid: { color: CHART_COLORS.line, drawBorder: false } }
      },
      plugins: {
        legend: {
          // Single-series chart — no legend needed for the main line, and we hide internals
          display: false
        },
        tooltip: {
          filter: (item) => {
            const label = item.dataset.label || '';
            return !label.startsWith('_');
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

/* =====================================================
   v1.3 — Seizure types over time

   Builds per-type time buckets so the dietitian/neurologist can see
   "is the absence frequency coming down?" without overlaying ketones
   (descriptive only — inference happens off-screen).

   Bucket sizes are anchored on `toMs` and walk backwards. The right-most
   bucket may be a partial period (today's week, this 30-day month).
   ===================================================== */

// Resolve a human-readable label from a seizure record + settings, without
// depending on app.js's `state`. Keep this in sync with seizureTypeLabel()
// in app.js — app.js's version is now a thin wrapper that passes settings.
function resolveSeizureTypeLabel(seizure, settings) {
  if (!seizure || !seizure.type) return 'Seizure';
  if (seizure.type === 'other') {
    const t = seizure.typeOther && seizure.typeOther.trim();
    return t ? t : 'Other';
  }
  if (typeof seizure.type === 'string' && seizure.type.startsWith('custom:')) {
    const idx = parseInt(seizure.type.split(':')[1], 10);
    const list = (settings && settings.customSeizureTypes) || [];
    return list[idx] || 'Custom';
  }
  return seizure.type.charAt(0).toUpperCase() + seizure.type.slice(1);
}

// Group key for a seizure — used to bucket events by type. We group all
// `other` events together under a single "__other__" key (descriptions
// vary by event, but the clinical question — "are unusual events becoming
// less frequent?" — still applies to the pool).
function _typeGroupKey(seizure) {
  if (!seizure || !seizure.type) return '__unknown__';
  if (seizure.type === 'other') return '__other__';
  return seizure.type;
}

// Display label for a group key. The "Other" group gets a "(descriptions
// vary)" suffix so a reader can see at a glance that the pool isn't a
// single named type.
function _typeGroupLabel(groupKey, sampleSeizure, settings) {
  if (groupKey === '__other__') return 'Other (descriptions vary)';
  if (groupKey === '__unknown__') return 'Seizure';
  if (groupKey.startsWith('custom:')) {
    return resolveSeizureTypeLabel(sampleSeizure, settings);
  }
  // Standard type — capitalise
  return groupKey.charAt(0).toUpperCase() + groupKey.slice(1);
}

// Build bucket boundaries for the period [fromMs, toMs].
//
// Supported bucket types:
//   'day'             — one bucket per calendar day (local time).
//   'calendar-week'   — Mon–Sun ISO weeks; first/last may be partial,
//                       labelled by the Monday of the week.
//   'calendar-month'  — Jan, Feb, Mar… proper calendar months. First and
//                       last buckets may be partial (e.g. "Apr 23 (from
//                       14)" or "May 26 (to 15)"). v1.5 — this is what
//                       the dr's spreadsheet uses, so it's the new
//                       default for ranges >60d.
//   'week'            — 7-day rolling windows anchored on toMs (legacy).
//   'month'           — 30-day rolling windows anchored on toMs (legacy).
//   'quarter'         — 90-day rolling windows anchored on toMs (legacy).
//
// For the rolling variants, the leftmost partial bucket (if any) is dropped
// so every visible bar represents the same span. For the calendar variants,
// partial first/last buckets are kept and labelled so the dr can see
// "this is the start of treatment, partial month".
//
// Returns [{ start, end, label, isPartial? }] in chronological order.
function _buildBuckets(fromMs, toMs, bucket) {
  // ----- Calendar-anchored variants (new in v1.5) -----
  if (bucket === 'calendar-month') return _buildCalendarMonthBuckets(fromMs, toMs);
  if (bucket === 'calendar-week')  return _buildCalendarWeekBuckets(fromMs, toMs);
  if (bucket === 'day')            return _buildDayBuckets(fromMs, toMs);

  // ----- Rolling variants (legacy) -----
  let spanMs;
  if (bucket === 'quarter') spanMs = 90 * 86400000;
  else if (bucket === 'month') spanMs = 30 * 86400000;
  else spanMs = 7 * 86400000;
  const out = [];
  let end = toMs;
  while (end > fromMs) {
    const start = end - spanMs + 1;
    if (start < fromMs) break;
    out.unshift({ start, end });
    end = start - 1;
  }
  if (!out.length) {
    out.push({ start: Math.max(toMs - spanMs + 1, fromMs), end: toMs });
  }
  const fmtShort = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  };
  return out.map(b => ({ ...b, label: fmtShort(b.start) }));
}

// Calendar months from the month containing fromMs to the month containing toMs.
// The first and last buckets are clipped to fromMs/toMs and labelled to make
// the partial nature visible.
function _buildCalendarMonthBuckets(fromMs, toMs) {
  if (toMs < fromMs) return [];
  const startD = new Date(fromMs);
  const endD   = new Date(toMs);
  const out = [];
  let y = startD.getFullYear();
  let m = startD.getMonth();
  const endY = endD.getFullYear();
  const endM = endD.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    const monthStart = new Date(y, m, 1, 0, 0, 0, 0).getTime();
    const monthEnd   = new Date(y, m + 1, 1, 0, 0, 0, 0).getTime() - 1;
    const bStart = Math.max(monthStart, fromMs);
    const bEnd   = Math.min(monthEnd, toMs);
    const monthLabel = new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    let label = monthLabel;
    const isPartialStart = bStart > monthStart;
    const isPartialEnd   = bEnd < monthEnd;
    if (isPartialStart && isPartialEnd) {
      const fromDay = new Date(bStart).getDate();
      const toDay   = new Date(bEnd).getDate();
      label = `${monthLabel} (${fromDay}–${toDay})`;
    } else if (isPartialStart) {
      const fromDay = new Date(bStart).getDate();
      label = `${monthLabel} (from ${fromDay})`;
    } else if (isPartialEnd) {
      const toDay = new Date(bEnd).getDate();
      label = `${monthLabel} (to ${toDay})`;
    }
    out.push({ start: bStart, end: bEnd, label, isPartial: isPartialStart || isPartialEnd });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

// Calendar Mon–Sun weeks covering [fromMs, toMs]. First/last may be partial
// and are labelled by the Monday of the ISO week (e.g. "12 May").
function _buildCalendarWeekBuckets(fromMs, toMs) {
  if (toMs < fromMs) return [];
  const d = new Date(fromMs);
  d.setHours(0, 0, 0, 0);
  // JS Sunday = 0, Monday = 1 ... so days-since-monday = (day + 6) % 7
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  let weekStart = d.getTime();
  const out = [];
  while (weekStart <= toMs) {
    const weekEnd = weekStart + 7 * 86400000 - 1;
    const bStart = Math.max(weekStart, fromMs);
    const bEnd   = Math.min(weekEnd, toMs);
    const label = new Date(weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const isPartial = bStart > weekStart || bEnd < weekEnd;
    out.push({ start: bStart, end: bEnd, label, isPartial });
    weekStart += 7 * 86400000;
  }
  return out;
}

// One bucket per calendar day in [fromMs, toMs].
function _buildDayBuckets(fromMs, toMs) {
  if (toMs < fromMs) return [];
  const out = [];
  const start = new Date(fromMs);
  start.setHours(0, 0, 0, 0);
  let t = start.getTime();
  while (t <= toMs) {
    const dayStart = t;
    const dayEnd   = t + 86400000 - 1;
    const bStart = Math.max(dayStart, fromMs);
    const bEnd   = Math.min(dayEnd, toMs);
    const label  = new Date(dayStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    out.push({ start: bStart, end: bEnd, label, isPartial: false });
    t += 86400000;
  }
  return out;
}

// v1.5 — auto-pick a bucket type from a range length in days.
//   ≤7 days   → 'day'              (per-day bars on a single week)
//   8–60 days → 'calendar-week'    (Mon–Sun weeks; partial ends labelled)
//   >60 days  → 'calendar-month'   (Jan/Feb/Mar… columns matching the dr's
//                                   spreadsheet, partial first/last months)
// Returns { bucket, label } where label is the bucketing name used in
// chart titles and tab headings ("daily", "weekly", "monthly").
function autoBucketForDays(days) {
  if (days <= 7)  return { bucket: 'day',            label: 'daily' };
  if (days <= 60) return { bucket: 'calendar-week',  label: 'weekly' };
  return                 { bucket: 'calendar-month', label: 'monthly' };
}

/* =====================================================
   v1.5 — Bucketed series builders

   Replacements for dailySeries / morningEveningSeries / dailyCounts that
   take a bucket type and aggregate the records into per-bucket values.

   The output shape is identical to the daily versions so all existing
   chart renderers (lineChartCombined, lineChartSplit, barChart) work
   unchanged — they just see fewer points with bucket-shaped labels.

   For continuous values (ketone, glucose, GKI) we take the mean within
   each bucket. For counts (seizures) we sum.

   For ≤7d ranges with 'day' bucketing, behaviour is equivalent to the
   v1.4 daily helpers.
   ===================================================== */
function bucketedSeries(records, valueKey, fromMs, toMs, bucket) {
  const buckets = _buildBuckets(fromMs, toMs, bucket);
  const cellValues = buckets.map(() => []);
  for (const r of records) {
    const ts = r.timestamp || r.startTime;
    if (ts < fromMs || ts > toMs) continue;
    const v = typeof valueKey === 'function' ? valueKey(r) : r[valueKey];
    if (v == null || isNaN(v)) continue;
    // Find bucket — linear scan, buckets are usually <=12 so this is cheap.
    for (let i = 0; i < buckets.length; i++) {
      if (ts >= buckets[i].start && ts <= buckets[i].end) {
        cellValues[i].push(v);
        break;
      }
    }
  }
  const labels = buckets.map(b => b.label);
  const data = cellValues.map(arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return { labels, data, buckets };
}

function bucketedMorningEveningSeries(records, valueKey, fromMs, toMs, bucket) {
  const buckets = _buildBuckets(fromMs, toMs, bucket);
  const cells = buckets.map(() => ({ morning: [], evening: [] }));
  for (const r of records) {
    const ts = r.timestamp || r.startTime;
    if (ts < fromMs || ts > toMs) continue;
    const v = typeof valueKey === 'function' ? valueKey(r) : r[valueKey];
    if (v == null || isNaN(v)) continue;
    const d = new Date(ts);
    const slot = d.getHours() < MORNING_END_HOUR ? 'morning' : 'evening';
    for (let i = 0; i < buckets.length; i++) {
      if (ts >= buckets[i].start && ts <= buckets[i].end) {
        cells[i][slot].push(v);
        break;
      }
    }
  }
  const labels = buckets.map(b => b.label);
  const morning = cells.map(c => c.morning.length ? c.morning.reduce((a, b) => a + b, 0) / c.morning.length : null);
  const evening = cells.map(c => c.evening.length ? c.evening.reduce((a, b) => a + b, 0) / c.evening.length : null);
  return { labels, morning, evening, buckets };
}

function bucketedCounts(records, fromMs, toMs, bucket) {
  const buckets = _buildBuckets(fromMs, toMs, bucket);
  const data = buckets.map(() => 0);
  for (const r of records) {
    const ts = r.timestamp || r.startTime;
    if (ts < fromMs || ts > toMs) continue;
    for (let i = 0; i < buckets.length; i++) {
      if (ts >= buckets[i].start && ts <= buckets[i].end) {
        data[i]++;
        break;
      }
    }
  }
  const labels = buckets.map(b => b.label);
  return { labels, data, buckets };
}

// v1.5 — seizure-day markers aligned to a bucket index instead of a day index.
// Returns [{ index, count }] where index is the position of the bucket in
// the labels array and count is the number of seizures in that bucket.
// Used by the AM/PM ketone chart on Patterns to show "this bucket had
// seizures" markers when the chart is monthly/weekly bucketed.
function seizureBucketMarkers(seizures, fromMs, toMs, bucket) {
  const buckets = _buildBuckets(fromMs, toMs, bucket);
  const counts = buckets.map(() => 0);
  for (const s of seizures) {
    if (s.startTime < fromMs || s.startTime > toMs) continue;
    for (let i = 0; i < buckets.length; i++) {
      if (s.startTime >= buckets[i].start && s.startTime <= buckets[i].end) {
        counts[i]++;
        break;
      }
    }
  }
  return counts
    .map((count, index) => ({ index, count }))
    .filter(m => m.count > 0);
}

// Median of a numeric array (returns null for empty input).
function _median(arr) {
  const v = arr.filter(x => x != null && !isNaN(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/* =====================================================
   Per-type frequency over time

   Returns [{ key, label, total, buckets: [{ start, end, label, count }] }]
   - One entry per type that had >=1 event in range.
   - Empty types filtered out.
   - Sorted by total desc so most-frequent types come first.
   ===================================================== */
function seizureTypeFrequencyByType(seizures, settings, fromMs, toMs, bucket) {
  const buckets = _buildBuckets(fromMs, toMs, bucket);
  const groups = {};

  for (const s of seizures) {
    if (s.startTime < fromMs || s.startTime > toMs) continue;
    const k = _typeGroupKey(s);
    if (!groups[k]) groups[k] = { sample: s, events: [] };
    groups[k].events.push(s);
  }

  const out = [];
  for (const [key, g] of Object.entries(groups)) {
    const typeBuckets = buckets.map(b => {
      const count = g.events.filter(e => e.startTime >= b.start && e.startTime <= b.end).length;
      return { start: b.start, end: b.end, label: b.label, count };
    });
    out.push({
      key,
      label: _typeGroupLabel(key, g.sample, settings),
      total: g.events.length,
      buckets: typeBuckets
    });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

/* =====================================================
   Per-type duration over time

   Returns [{ key, label, totalWithDuration, buckets: [{ start, end, label,
     count, median, durations: [secs...] }] }]
   - Only events with a numeric durationSec are included.
   - Types with zero timed events in range are filtered out.
   - Per bucket: count = number of timed events, median = median seconds,
     durations = raw list so the renderer can switch to dot-mode at count<3.
   ===================================================== */
function seizureTypeDurationByType(seizures, settings, fromMs, toMs, bucket) {
  const buckets = _buildBuckets(fromMs, toMs, bucket);
  const groups = {};

  for (const s of seizures) {
    if (s.startTime < fromMs || s.startTime > toMs) continue;
    if (s.durationSec == null || isNaN(s.durationSec)) continue;
    const k = _typeGroupKey(s);
    if (!groups[k]) groups[k] = { sample: s, events: [] };
    groups[k].events.push(s);
  }

  const out = [];
  for (const [key, g] of Object.entries(groups)) {
    const typeBuckets = buckets.map(b => {
      const inBucket = g.events.filter(e => e.startTime >= b.start && e.startTime <= b.end);
      const durations = inBucket.map(e => e.durationSec);
      return {
        start: b.start,
        end: b.end,
        label: b.label,
        count: durations.length,
        median: _median(durations),
        durations
      };
    });
    out.push({
      key,
      label: _typeGroupLabel(key, g.sample, settings),
      totalWithDuration: g.events.length,
      buckets: typeBuckets
    });
  }
  out.sort((a, b) => b.totalWithDuration - a.totalWithDuration);
  return out;
}

// Format seconds as mm:ss for tooltip display.
function _fmtDuration(secs) {
  if (secs == null) return '—';
  const s = Math.round(secs);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/* =====================================================
   v1.5 — seizureTypesByPeriodTable

   Combined frequency + duration table data for the new Patterns monthly
   tables, the PDF monthly tables, and the XLSX Monthly tab. Replaces the
   v1.3 small-multiples mini-charts: tables read more honestly at small
   numbers than tiny bars, and they match the parent's-spreadsheet view
   that clinicians find useful.

   Returns:
   {
     bucket,         // requested bucket type
     bucketLabel,    // 'daily' | 'weekly' | 'monthly'
     buckets: [{ start, end, label, isPartial }],
     types: [{
       key, label,
       totalCount,           // sum across all buckets in range
       totalDurations: [..], // every recorded durationSec across range
       cells: [{
         count,              // # events in this bucket
         median,             // median durationSec, only if count >= 3
         durations: [..]     // raw seconds list for the bucket (any size)
       }]
     }]
   }

   Sorted by totalCount desc so the most-frequent types appear at the top
   of the table — matching how the parent's sheet lays out Drop first.
   ===================================================== */
function seizureTypesByPeriodTable(seizures, settings, fromMs, toMs, bucket) {
  const buckets = _buildBuckets(fromMs, toMs, bucket);
  const groups = {};

  for (const s of seizures) {
    if (s.startTime < fromMs || s.startTime > toMs) continue;
    const k = _typeGroupKey(s);
    if (!groups[k]) groups[k] = { sample: s, events: [] };
    groups[k].events.push(s);
  }

  const types = [];
  for (const [key, g] of Object.entries(groups)) {
    const cells = buckets.map(b => {
      const inBucket = g.events.filter(e => e.startTime >= b.start && e.startTime <= b.end);
      const durations = inBucket
        .map(e => e.durationSec)
        .filter(d => d != null && !isNaN(d));
      return {
        count: inBucket.length,
        durations,
        median: durations.length >= 3 ? _median(durations) : null
      };
    });
    const totalDurations = g.events
      .map(e => e.durationSec)
      .filter(d => d != null && !isNaN(d));
    types.push({
      key,
      label: _typeGroupLabel(key, g.sample, settings),
      totalCount: g.events.length,
      totalDurations,
      cells
    });
  }
  types.sort((a, b) => b.totalCount - a.totalCount);

  // Bucket label — derive from the bucket name for display purposes.
  let bucketLabel = 'weekly';
  if (bucket === 'day') bucketLabel = 'daily';
  else if (bucket === 'calendar-month' || bucket === 'month' || bucket === 'quarter') {
    bucketLabel = bucket === 'quarter' ? 'quarterly' : 'monthly';
  }

  return { bucket, bucketLabel, buckets, types };
}

/* =====================================================
   Small-multiples mini-chart for one seizure type

   One canvas, one type, one metric (frequency OR duration).
   In duration mode, buckets with count < 3 render their individual events
   as dots overlaid on the column; buckets with count >= 3 render a bar
   at the median height. This makes "this is 2 readings, not a real
   average" visually obvious.
   ===================================================== */
function seizureTypeSmallMultipleChart(canvasId, buckets, color, mode) {
  applyChartDefaults();
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const labels = buckets.map(b => b.label);
  let datasets;
  let yMax;
  let tooltipLabelCallback;

  if (mode === 'duration') {
    const barData = buckets.map(b => (b.count >= 3 && b.median != null) ? b.median : null);
    const dotPoints = [];
    buckets.forEach((b, i) => {
      if (b.count > 0 && b.count < 3) {
        b.durations.forEach(d => { if (d != null) dotPoints.push({ x: labels[i], y: d }); });
      }
    });

    datasets = [
      {
        type: 'bar',
        label: 'Median',
        data: barData,
        backgroundColor: color,
        borderRadius: 4,
        maxBarThickness: 22
      },
      {
        type: 'scatter',
        label: 'Events',
        data: dotPoints,
        backgroundColor: color,
        borderColor: '#fffaf2',
        borderWidth: 1,
        pointRadius: 3.5,
        pointHoverRadius: 4.5,
        showLine: false
      }
    ];

    const allDur = [
      ...barData.filter(v => v != null),
      ...dotPoints.map(p => p.y)
    ];
    yMax = allDur.length ? Math.max(...allDur) * 1.15 : 60;
    if (yMax < 30) yMax = 30;

    tooltipLabelCallback = (item) => {
      if (item.dataset.type === 'scatter') {
        return `Event: ${_fmtDuration(item.parsed.y)}`;
      }
      const bucket = buckets[item.dataIndex];
      const n = bucket ? bucket.count : 0;
      return `Median: ${_fmtDuration(item.parsed.y)} (n=${n})`;
    };
  } else {
    const counts = buckets.map(b => b.count);
    datasets = [{
      type: 'bar',
      label: 'Events',
      data: counts,
      backgroundColor: color,
      borderRadius: 4,
      maxBarThickness: 22
    }];
    const maxCount = counts.length ? Math.max(...counts, 1) : 1;
    yMax = Math.max(maxCount + 1, 3);
    tooltipLabelCallback = (item) => {
      const n = item.parsed.y;
      return `${n} event${n === 1 ? '' : 's'}`;
    };
  }

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => (items && items.length) ? (items[0].label || '') : '',
            label: tooltipLabelCallback
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          suggestedMax: yMax,
          ticks: {
            stepSize: mode === 'duration' ? undefined : 1,
            precision: mode === 'duration' ? undefined : 0,
            font: { size: 10 },
            callback: mode === 'duration'
              ? (v) => _fmtDuration(v)
              : undefined
          },
          grid: { color: CHART_COLORS.line, drawBorder: false }
        }
      }
    }
  });
}

/* =====================================================
   Seizures-by-type count tally (for the new Patterns stat card)

   Returns [{ key, label, count }] sorted desc by count.
   Empty types filtered out.
   ===================================================== */
function seizureTypeCounts(seizures, settings) {
  const groups = {};
  for (const s of seizures) {
    const k = _typeGroupKey(s);
    if (!groups[k]) groups[k] = { sample: s, count: 0 };
    groups[k].count++;
  }
  return Object.entries(groups)
    .map(([key, g]) => ({ key, label: _typeGroupLabel(key, g.sample, settings), count: g.count }))
    .sort((a, b) => b.count - a.count);
}

/* =====================================================
   Exports
   ===================================================== */

window.KCCharts = {
  COLORS: CHART_COLORS,
  MORNING_END_HOUR,
  applyChartDefaults,
  morningEveningSeries,
  dailySeries,
  dailyCounts,
  seizureDayMarkers,
  seizuresByHour,
  weeklyHeatmap,
  triggerCounts,
  lineChartSplit,
  lineChartCombined,
  barChart,
  horizontalBarChart,
  hourHistogramChart,
  computeStats,
  destroyChart,
  suggestedYMax,
  // v1.3
  resolveSeizureTypeLabel,
  seizureTypeFrequencyByType,
  seizureTypeDurationByType,
  seizureTypeSmallMultipleChart,
  seizureTypeCounts,
  // v1.5
  autoBucketForDays,
  seizureTypesByPeriodTable,
  bucketedSeries,
  bucketedMorningEveningSeries,
  bucketedCounts,
  seizureBucketMarkers,
  // Helpers exposed for export.js + app.js label formatting
  fmtDurationMmSs: _fmtDuration
};
