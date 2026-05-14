/* =====================================================
   export.js — CSV, PDF, JSON export
   ===================================================== */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function fmtDateISO(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function fmtTimeISO(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDateTime(ms) {
  return `${fmtDateISO(ms)} ${fmtTimeISO(ms)}`;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function exportXLSX(fromMs, toMs) {
  if (!window.XLSX) {
    alert('Spreadsheet library not loaded. Please connect to the internet once to fetch it, then try again.');
    return;
  }

  const settings = await KCDB.getSettings();
  const measurements = await KCDB.getMeasurementsBetween(fromMs, toMs);
  const seizures = await KCDB.getSeizuresBetween(fromMs, toMs);

  measurements.sort((a, b) => a.timestamp - b.timestamp);
  seizures.sort((a, b) => a.startTime - b.startTime);

  const wb = XLSX.utils.book_new();

  // ---------- Tab 1: Summary ----------
  const summarySheet = buildSummarySheet(settings, measurements, seizures, fromMs, toMs);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // ---------- Tab 2: Daily ----------
  const dailySheet = buildDailySheet(settings, measurements, seizures, fromMs, toMs);
  XLSX.utils.book_append_sheet(wb, dailySheet, 'Daily');

  // ---------- Tab 3: Measurements ----------
  const measSheet = buildMeasurementsSheet(measurements, settings);
  XLSX.utils.book_append_sheet(wb, measSheet, 'Measurements');

  // ---------- Tab 4: Seizures ----------
  const seizSheet = buildSeizuresSheet(seizures, measurements, settings);
  XLSX.utils.book_append_sheet(wb, seizSheet, 'Seizures');

  // ---------- Tab 5: About ----------
  const aboutSheet = buildAboutSheet(settings, fromMs, toMs, measurements.length, seizures.length);
  XLSX.utils.book_append_sheet(wb, aboutSheet, 'About');

  const filename = `ketocare_${(settings.childName || 'export').replace(/\s+/g,'_').toLowerCase()}_${fmtDateISO(fromMs)}_to_${fmtDateISO(toMs)}_full.xlsx`;
  XLSX.writeFile(wb, filename);
}

/* ---------- Sheet builders ---------- */

function buildSummarySheet(settings, measurements, seizures, fromMs, toMs) {
  const ketones = measurements.filter(m => m.bloodKetone != null).map(m => m.bloodKetone);
  const glucoses = measurements.filter(m => m.glucose != null).map(m => m.glucose);
  const gkis = measurements
    .filter(m => m.bloodKetone && m.glucose && m.bloodKetone > 0)
    .map(m => m.glucose / m.bloodKetone);

  const kStats = stats(ketones);
  const gStats = stats(glucoses);
  const giStats = stats(gkis);

  const inTargetK = (settings.ketoneMin != null && settings.ketoneMax != null)
    ? ketones.filter(v => v >= settings.ketoneMin && v <= settings.ketoneMax).length
    : null;
  const inTargetG = (settings.gkiMin != null && settings.gkiMax != null)
    ? gkis.filter(v => v >= settings.gkiMin && v <= settings.gkiMax).length
    : null;

  // Days affected by seizures
  const seizureDays = new Set(seizures.map(s => isoDateMs(s.startTime)));
  const totalDur = seizures.reduce((a, s) => a + (s.durationSec || 0), 0);

  // Most common seizure type — tally by display label so custom/'other' show
  // their human-readable names rather than raw keys like 'custom:0'.
  const typeCount = {};
  for (const s of seizures) {
    const label = formatSeizureType(s, settings);
    if (label) typeCount[label] = (typeCount[label] || 0) + 1;
  }
  const topType = Object.keys(typeCount).sort((a, b) => typeCount[b] - typeCount[a])[0] || '—';

  const totalDays = Math.max(1, Math.round((toMs - fromMs) / 86400000));

  const rows = [
    ['KetoCare summary', ''],
    ['', ''],
    ['Child', settings.childName || '—'],
    ['Date of birth', settings.dob || '—'],
    ['Diet variant', formatVariant(settings.variant, settings)],
    ['Period', `${fmtDateUK(fromMs)} to ${fmtDateUK(toMs)}`],
    ['Days in period', totalDays],
    ['Generated', new Date().toLocaleString('en-GB')],
    ['', ''],
    ['Blood ketone — mmol/L', ''],
    ['  Readings (n)', kStats.n],
    ['  Mean', kStats.mean],
    ['  Median', kStats.median],
    ['  Range', kStats.n ? `${kStats.min} to ${kStats.max}` : '—'],
  ];
  if (inTargetK != null && kStats.n > 0) {
    const pct = Math.round(100 * inTargetK / kStats.n);
    rows.push(['  In target', `${pct}% (${inTargetK} of ${kStats.n} readings, target ${settings.ketoneMin}–${settings.ketoneMax})`]);
  } else if (kStats.n > 0) {
    rows.push(['  In target', '— (no target range set)']);
  }
  rows.push(['', '']);
  rows.push(['Glucose — mmol/L', '']);
  rows.push(['  Readings (n)', gStats.n]);
  rows.push(['  Mean', gStats.mean]);
  rows.push(['  Median', gStats.median]);
  rows.push(['  Range', gStats.n ? `${gStats.min} to ${gStats.max}` : '—']);
  rows.push(['', '']);
  rows.push(['GKI (Glucose-Ketone Index)', '']);
  rows.push(['  Readings (n)', giStats.n]);
  rows.push(['  Mean', giStats.mean]);
  rows.push(['  Median', giStats.median]);
  rows.push(['  Range', giStats.n ? `${giStats.min} to ${giStats.max}` : '—']);
  if (inTargetG != null && giStats.n > 0) {
    const pct = Math.round(100 * inTargetG / giStats.n);
    rows.push(['  In target', `${pct}% (${inTargetG} of ${giStats.n}, target ${settings.gkiMin}–${settings.gkiMax})`]);
  }
  rows.push(['', '']);
  rows.push(['Seizures', '']);
  rows.push(['  Total', seizures.length]);
  rows.push(['  Days affected', `${seizureDays.size} of ${totalDays}`]);
  rows.push(['  Total duration', `${Math.floor(totalDur/60)}m ${totalDur%60}s`]);
  rows.push(['  Average duration', seizures.length ? `${Math.round(totalDur/seizures.length)}s` : '—']);
  rows.push(['  Most common type', topType]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 32 }, { wch: 50 }];
  // Bold for section headers (rows 0, 9, 16, 23, 30 — but XLSX cell formatting with SheetJS community is limited)
  return ws;
}

function buildDailySheet(settings, measurements, seizures, fromMs, toMs) {
  // Build day buckets across the full date range
  const days = new Map();
  const dayStart = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  // Iterate every calendar day in range
  for (let t = dayStart(fromMs); t <= toMs; t += 86400000) {
    days.set(t, { date: new Date(t), ketones: [], glucoses: [], gkis: [], firstK: null, lastK: null, seizures: [] });
  }
  for (const m of measurements) {
    const k = dayStart(m.timestamp);
    const b = days.get(k);
    if (!b) continue;
    if (m.bloodKetone != null) {
      b.ketones.push(m.bloodKetone);
      if (!b.firstK || m.timestamp < b.firstK.t) b.firstK = { t: m.timestamp, v: m.bloodKetone };
      if (!b.lastK || m.timestamp > b.lastK.t) b.lastK = { t: m.timestamp, v: m.bloodKetone };
    }
    if (m.glucose != null) b.glucoses.push(m.glucose);
    if (m.bloodKetone && m.glucose && m.bloodKetone > 0) b.gkis.push(m.glucose / m.bloodKetone);
  }
  for (const s of seizures) {
    const k = dayStart(s.startTime);
    if (days.has(k)) days.get(k).seizures.push(s);
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const headers = [
    'Date', 'Day',
    'AM ketone', 'PM ketone', 'Mean ketone',
    'Mean glucose', 'Mean GKI',
    'In ketone target?', 'Seizures', 'Seizure duration',
    'Notes (count)'
  ];
  const rows = [headers];

  const sortedKeys = [...days.keys()].sort((a, b) => a - b);
  for (const k of sortedKeys) {
    const b = days.get(k);
    // AM = before noon, PM = noon or later
    const noon = k + 12 * 3600 * 1000;
    const amK = b.firstK && b.firstK.t < noon ? b.firstK.v : '';
    const pmK = b.lastK && b.lastK.t >= noon ? b.lastK.v : '';
    const meanK = mean(b.ketones);
    const meanG = mean(b.glucoses);
    const meanGI = mean(b.gkis);

    let inTarget = '';
    if (b.ketones.length && settings.ketoneMin != null && settings.ketoneMax != null) {
      const allIn = b.ketones.every(v => v >= settings.ketoneMin && v <= settings.ketoneMax);
      const allOut = b.ketones.every(v => v < settings.ketoneMin || v > settings.ketoneMax);
      inTarget = allIn ? 'Yes' : (allOut ? 'No' : 'Mixed');
    }

    const totalDur = b.seizures.reduce((a, s) => a + (s.durationSec || 0), 0);

    rows.push([
      fmtDateUK(k),
      dayNames[b.date.getDay()],
      amK === '' ? '' : round1(amK),
      pmK === '' ? '' : round1(pmK),
      meanK === '' ? '' : round1(meanK),
      meanG === '' ? '' : round1(meanG),
      meanGI === '' ? '' : round2(meanGI),
      inTarget,
      b.seizures.length || '',
      totalDur ? `${Math.floor(totalDur/60)}m ${totalDur%60}s` : ''
    ]);
  }

  // Strip the last column (Notes count) from headers + rows since we didn't fill it
  const cleaned = rows.map(r => r.slice(0, 10));

  const ws = XLSX.utils.aoa_to_sheet(cleaned);
  ws['!cols'] = [
    { wch: 12 }, { wch: 5 }, { wch: 11 }, { wch: 11 }, { wch: 13 },
    { wch: 13 }, { wch: 11 }, { wch: 16 }, { wch: 9 }, { wch: 16 }
  ];
  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!autofilter'] = { ref: `A1:J${cleaned.length}` };
  return ws;
}

function buildMeasurementsSheet(measurements, settings) {
  const headers = [
    'Date', 'Time', 'Method', 'Ketone (mmol/L)', 'Urine ketone', 'Glucose (mmol/L)', 'GKI', 'In target?', 'Notes'
  ];
  const rows = [headers];
  for (const m of measurements) {
    const d = new Date(m.timestamp);
    const method = m.bloodKetone != null ? 'Blood' : (m.urineKetone != null ? 'Urine' : '');
    const gki = (m.bloodKetone && m.glucose && m.bloodKetone > 0) ? round2(m.glucose / m.bloodKetone) : '';
    const inT = (m.bloodKetone != null && settings.ketoneMin != null && settings.ketoneMax != null)
      ? (m.bloodKetone >= settings.ketoneMin && m.bloodKetone <= settings.ketoneMax ? 'Yes' : 'No')
      : '';
    rows.push([
      fmtDateUK(m.timestamp),
      fmtTime24(d),
      method,
      m.bloodKetone != null ? m.bloodKetone : '',
      m.urineKetone != null ? urineLabel(m.urineKetone) : '',
      m.glucose != null ? m.glucose : '',
      gki,
      inT,
      m.notes || ''
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 7 }, { wch: 11 }, { wch: 36 }
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!autofilter'] = { ref: `A1:I${rows.length}` };
  return ws;
}

function buildSeizuresSheet(seizures, measurements, settings) {
  const headers = [
    'Date', 'Time', 'Type', 'Duration', 'Triggers', 'Rescue medication', 'Recovery (min)',
    'Last ketone before', 'Hours before', 'First ketone after', 'Hours after', 'Notes'
  ];
  const rows = [headers];

  for (const s of seizures) {
    const d = new Date(s.startTime);
    const min = Math.floor((s.durationSec || 0) / 60);
    const sec = (s.durationSec || 0) % 60;
    const dur = s.durationSec ? `${min}m ${sec}s` : '—';

    const prev = findNearestBefore(measurements, s.startTime, m => m.bloodKetone != null);
    const next = findNearestAfter(measurements, s.startTime, m => m.bloodKetone != null);

    rows.push([
      fmtDateUK(s.startTime),
      fmtTime24(d),
      formatSeizureType(s, settings),
      dur,
      (s.triggers || []).map(t => t.replace('-', ' ')).join('; '),
      s.rescueMed || '',
      s.recoveryMin != null ? s.recoveryMin : '',
      prev ? `${prev.bloodKetone} mmol/L` : '',
      prev ? round1((s.startTime - prev.timestamp) / 3600000) : '',
      next ? `${next.bloodKetone} mmol/L` : '',
      next ? round1((next.timestamp - s.startTime) / 3600000) : '',
      s.notes || ''
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 9 }, { wch: 28 }, { wch: 22 }, { wch: 13 },
    { wch: 17 }, { wch: 11 }, { wch: 18 }, { wch: 11 }, { wch: 36 }
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!autofilter'] = { ref: `A1:L${rows.length}` };
  return ws;
}

function buildAboutSheet(settings, fromMs, toMs, nMeas, nSeiz) {
  const rows = [
    ['About this file'],
    [''],
    ['This spreadsheet was exported from KetoCare, a tracking tool used by'],
    ['parents of children on the ketogenic diet for epilepsy.'],
    [''],
    ['Tabs'],
    ['  Summary       — overview of the period at a glance.'],
    ['  Daily         — one row per day. Best place to spot patterns.'],
    ['  Measurements  — every ketone/glucose reading recorded.'],
    ['  Seizures      — every seizure recorded, with the closest ketone'],
    ['                  reading before and after each event.'],
    ['  About         — this page.'],
    [''],
    ['Units'],
    ['  Ketone   mmol/L (β-hydroxybutyrate)'],
    ['  Glucose  mmol/L'],
    ['  GKI      Glucose ÷ Ketone (both in mmol/L)'],
    [''],
    ['Urine ketone scale'],
    ['  Strips give a colour-band reading. The Measurements tab shows the'],
    ['  band name. For reference these correspond approximately to:'],
    ['  Negative          0 mmol/L'],
    ['  Trace             ~0.5 mmol/L'],
    ['  Small (+)         ~1.5 mmol/L'],
    ['  Moderate (++)     ~4 mmol/L'],
    ['  Large (+++)       ~8 mmol/L'],
    ['  Very large (++++) ~16 mmol/L'],
    [''],
    ['Notes on the data'],
    ['  • All values are parent-reported. Ketone meters and urine strips'],
    ['    have known measurement variability; treat extreme single values'],
    ['    with appropriate caution.'],
    ['  • GKI is only calculated when both blood ketone and glucose were'],
    ['    measured at the same time.'],
    ['  • The "Last ketone before" / "First ketone after" columns on the'],
    ['    Seizures tab show the nearest blood ketone reading on either'],
    ['    side of each seizure. The hours-gap column tells you how close'],
    ['    in time that reading was.'],
    ['  • The "In target" columns use the target range set by the family'],
    ['    in the app settings (typically agreed with their dietitian).'],
    [''],
    ['Export details'],
    ['  Child name      ' + (settings.childName || '—')],
    ['  Diet variant    ' + formatVariant(settings.variant, settings)],
    ['  Period          ' + fmtDateUK(fromMs) + ' to ' + fmtDateUK(toMs)],
    ['  Records         ' + nMeas + ' measurements, ' + nSeiz + ' seizures'],
    ['  Generated       ' + new Date().toLocaleString('en-GB')]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 78 }];
  return ws;
}

/* ---------- formatting helpers ---------- */

function fmtDateUK(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
}
function fmtTime24(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isoDateMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function capitalise(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function mean(arr) {
  if (!arr.length) return '';
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stats(vals) {
  const n = vals.length;
  if (!n) return { n: 0, min: '—', max: '—', mean: '—', median: '—' };
  const sorted = [...vals].sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n,
    min: round2(sorted[0]),
    max: round2(sorted[n - 1]),
    mean: round2(sum / n),
    median: round2(median)
  };
}
function findNearestBefore(arr, ts, predicate) {
  let best = null;
  for (const r of arr) {
    if (r.timestamp < ts && predicate(r)) {
      if (!best || r.timestamp > best.timestamp) best = r;
    }
  }
  return best;
}
function findNearestAfter(arr, ts, predicate) {
  let best = null;
  for (const r of arr) {
    if (r.timestamp > ts && predicate(r)) {
      if (!best || r.timestamp < best.timestamp) best = r;
    }
  }
  return best;
}

async function exportJSON() {
  const data = await KCDB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const filename = `ketocare_backup_${fmtDateISO(Date.now())}.json`;
  downloadBlob(blob, filename);
}

async function exportPDF(fromMs, toMs) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const settings = await KCDB.getSettings();
  const measurements = await KCDB.getMeasurementsBetween(fromMs, toMs);
  const seizures = await KCDB.getSeizuresBetween(fromMs, toMs);

  const PAGE_W = 210;
  const MARGIN = 15;
  let y = MARGIN;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(45, 42, 38);
  doc.text('KetoCare Clinic Summary', MARGIN, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 84, 76);
  doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, MARGIN, y);
  y += 8;

  // Divider
  doc.setDrawColor(227, 216, 197);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;

  // Child info
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text('Child', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(settings.childName || '—', MARGIN + 30, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Date of birth', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(settings.dob || '—', MARGIN + 30, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Diet variant', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(formatVariant(settings.variant, settings), MARGIN + 30, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Period', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${fmtDateISO(fromMs)} to ${fmtDateISO(toMs)}`, MARGIN + 30, y);
  y += 8;

  // Stats section
  const ketoneVals = measurements.filter(m => m.bloodKetone).map(m => m.bloodKetone);
  const glucoseVals = measurements.filter(m => m.glucose).map(m => m.glucose);
  const gkiVals = measurements
    .filter(m => m.bloodKetone && m.glucose && m.bloodKetone > 0)
    .map(m => m.glucose / m.bloodKetone);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Summary statistics', MARGIN, y);
  y += 6;

  const renderStatLine = (name, vals, unit) => {
    const stats = KCCharts.computeStats(vals);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(name, MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 84, 76);
    doc.text(
      `min ${stats.min} · max ${stats.max} · mean ${stats.mean} · median ${stats.median} · n=${stats.count}${unit ? ' ' + unit : ''}`,
      MARGIN + 35, y
    );
    doc.setTextColor(45, 42, 38);
    y += 5;
  };

  renderStatLine('Blood ketone', ketoneVals, 'mmol/L');
  renderStatLine('Glucose',     glucoseVals, 'mmol/L');
  renderStatLine('GKI',         gkiVals, '');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Seizures', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90, 84, 76);
  const totalDur = seizures.reduce((a,b) => a + (b.durationSec || 0), 0);
  doc.text(
    `total ${seizures.length} · combined duration ${Math.round(totalDur/60)} min · avg ${seizures.length ? Math.round(totalDur/seizures.length) : 0} sec`,
    MARGIN + 35, y
  );
  doc.setTextColor(45, 42, 38);
  y += 8;

  // Charts — render fresh to off-screen canvases so this works regardless of
  // which screen the user is on. The PDF uses combined-mode (single line per
  // chart, all readings on a day averaged) to match the default in-app view.
  const ketoneSeries  = KCCharts.dailySeries(measurements, 'bloodKetone', fromMs, toMs);
  const glucoseSeries = KCCharts.dailySeries(measurements, 'glucose', fromMs, toMs);
  const gkiSeries     = KCCharts.dailySeries(
    measurements,
    (r) => (r.bloodKetone && r.glucose && r.bloodKetone > 0 ? r.glucose / r.bloodKetone : null),
    fromMs, toMs
  );
  const seizureSeries = KCCharts.dailyCounts(seizures, fromMs, toMs);
  const seizureMarkers = KCCharts.seizureDayMarkers(seizures, fromMs, toMs);
  const hourSeries = KCCharts.seizuresByHour(seizures);

  y = await renderOffscreenCombinedLineChartToPDF(doc, 'Ketone trend (mmol/L)', y, MARGIN, PAGE_W,
    ketoneSeries, KCCharts.COLORS.sageDeep,
    (settings.ketoneMin && settings.ketoneMax) ? { min: settings.ketoneMin, max: settings.ketoneMax } : null,
    null);
  y = await renderOffscreenCombinedLineChartToPDF(doc, 'Glucose trend (mmol/L)', y, MARGIN, PAGE_W,
    glucoseSeries, KCCharts.COLORS.honey, null, null);
  y = await renderOffscreenCombinedLineChartToPDF(doc, 'GKI trend', y, MARGIN, PAGE_W,
    gkiSeries, KCCharts.COLORS.terra,
    (settings.gkiMin != null && settings.gkiMax != null) ? { min: settings.gkiMin, max: settings.gkiMax } : null,
    null);
  y = await renderOffscreenBarChartToPDF(doc, 'Seizure frequency', y, MARGIN, PAGE_W,
    seizureSeries.labels, seizureSeries.data, KCCharts.COLORS.terraDeep);

  // ===== Patterns section — own page so dietitians can find/skip easily =====
  doc.addPage();
  y = MARGIN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(45, 42, 38);
  doc.text('Patterns', MARGIN, y);
  y += 6;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(138, 130, 120);
  const introLines = doc.splitTextToSize(
    'Exploratory views for spotting individual patterns in the data — descriptive only, not for clinical decisions.',
    PAGE_W - MARGIN * 2
  );
  doc.text(introLines, MARGIN, y);
  y += introLines.length * 4 + 4;

  // AM/PM split stats table
  doc.setTextColor(45, 42, 38);
  y = renderPatternsStatsTable(doc, MARGIN, y, PAGE_W, measurements, seizures, fromMs, toMs);

  // v1.3 — Seizures by type list (compact panel under AM/PM stats)
  y = renderPatternsTypeCountList(doc, MARGIN, y, PAGE_W, seizures, settings);

  // AM/PM ketone chart with seizure markers
  const ketoneSplit = KCCharts.morningEveningSeries(measurements, 'bloodKetone', fromMs, toMs);
  y = await renderOffscreenSplitLineChartToPDF(doc, 'Ketone trend — AM vs PM (mmol/L)', y, MARGIN, PAGE_W,
    ketoneSplit, KCCharts.COLORS.sage, KCCharts.COLORS.sageDeep,
    (settings.ketoneMin && settings.ketoneMax) ? { min: settings.ketoneMin, max: settings.ketoneMax } : null,
    seizureMarkers);

  // v1.3 — Seizure types over time (small-multiples frequency + duration)
  // Range here covers the full export window. We pick weekly buckets when the
  // window is <=30 days, monthly otherwise — matches the in-app behaviour.
  const rangeDays = Math.ceil((toMs - fromMs) / 86400000);
  if (rangeDays >= 14) {
    const bucket = rangeDays <= 30 ? 'week' : 'month';
    const freqData = KCCharts.seizureTypeFrequencyByType(seizures, settings, fromMs, toMs, bucket);
    if (freqData.length) {
      y = await renderSeizureTypesGridToPDF(doc, 'Seizure types — frequency over time', y, MARGIN, PAGE_W,
        freqData, 'frequency');
    }
    const durData = KCCharts.seizureTypeDurationByType(seizures, settings, fromMs, toMs, bucket);
    if (durData.length) {
      y = await renderSeizureTypesGridToPDF(doc, 'Seizure types — duration over time (median; dots = <3 events)', y, MARGIN, PAGE_W,
        durData, 'duration');
    }
  }

  // Hour-of-day histogram
  y = await renderOffscreenHourHistogramToPDF(doc, 'Seizures by hour of day', y, MARGIN, PAGE_W,
    hourSeries.data, KCCharts.COLORS.terraDeep);

  // Day-of-week heatmap (only meaningful at >=14d range, which the PDF
  // always satisfies because it covers the full export range).
  y = renderHeatmapToPDF(doc, 'Day-of-week heatmap', y, MARGIN, PAGE_W,
    KCCharts.weeklyHeatmap(seizures, fromMs, toMs));

  // Triggers tally
  const triggers = KCCharts.triggerCounts(seizures);
  if (triggers.items.length) {
    y = await renderOffscreenHorizontalBarChartToPDF(doc, 'Triggers logged', y, MARGIN, PAGE_W,
      triggers.items.map(t => t.label), triggers.items.map(t => t.count),
      KCCharts.COLORS.terraDeep);
  }

  // Event log on a new page
  doc.addPage();
  y = MARGIN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(45, 42, 38);
  doc.text('Event log', MARGIN, y);
  y += 7;

  const events = [];
  measurements.forEach(m => events.push({ ts: m.timestamp, kind: 'measurement', data: m }));
  seizures.forEach(s => events.push({ ts: s.startTime, kind: 'seizure', data: s }));
  events.sort((a, b) => a.ts - b.ts);

  doc.setFontSize(9);

  if (!events.length) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(138, 130, 120);
    doc.text('No events recorded in this period.', MARGIN, y);
  }

  for (const ev of events) {
    if (y > 270) { doc.addPage(); y = MARGIN; }

    if (ev.kind === 'measurement') {
      const m = ev.data;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(79, 107, 79);
      doc.text(fmtDateTime(m.timestamp), MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(45, 42, 38);
      const parts = [];
      if (m.bloodKetone)         parts.push(`Blood ketone ${m.bloodKetone} mmol/L`);
      if (m.urineKetone != null) parts.push(`Urine ketone ${urineLabel(m.urineKetone)}`);
      if (m.glucose)             parts.push(`Glucose ${m.glucose} mmol/L`);
      if (m.bloodKetone && m.glucose) parts.push(`GKI ${(m.glucose/m.bloodKetone).toFixed(2)}`);
      doc.text(parts.join(' · '), MARGIN + 32, y);
      y += 4.5;
      if (m.notes) {
        doc.setTextColor(90, 84, 76);
        const split = doc.splitTextToSize(`Notes: ${m.notes}`, PAGE_W - MARGIN*2 - 32);
        doc.text(split, MARGIN + 32, y);
        y += split.length * 4;
        doc.setTextColor(45, 42, 38);
      }
      y += 1.5;
    } else {
      const s = ev.data;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(168, 90, 72);
      doc.text(fmtDateTime(s.startTime), MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(45, 42, 38);
      const parts = [`SEIZURE — ${formatSeizureType(s, settings) || 'unspecified'}`];
      if (s.durationSec)       parts.push(`${s.durationSec}s`);
      if (s.recoveryMin != null) parts.push(`recovery ${s.recoveryMin} min`);
      doc.text(parts.join(' · '), MARGIN + 32, y);
      y += 4.5;
      if (s.triggers && s.triggers.length) {
        doc.setTextColor(90, 84, 76);
        doc.text(`Triggers: ${s.triggers.join(', ')}`, MARGIN + 32, y);
        y += 4;
      }
      if (s.rescueMed) {
        doc.setTextColor(90, 84, 76);
        doc.text(`Rescue med: ${s.rescueMed}`, MARGIN + 32, y);
        y += 4;
      }
      if (s.notes) {
        doc.setTextColor(90, 84, 76);
        const split = doc.splitTextToSize(`Notes: ${s.notes}`, PAGE_W - MARGIN*2 - 32);
        doc.text(split, MARGIN + 32, y);
        y += split.length * 4;
      }
      doc.setTextColor(45, 42, 38);
      y += 1.5;
    }
  }

  // Footer on last page
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(138, 130, 120);
    doc.text(`KetoCare · page ${i} of ${pageCount}`, PAGE_W - MARGIN, 290, { align: 'right' });
  }

  const filename = `ketocare_${(settings.childName || 'export').replace(/\s+/g,'_').toLowerCase()}_${fmtDateISO(fromMs)}_to_${fmtDateISO(toMs)}_summary.pdf`;
  doc.save(filename);
}

/**
 * Off-screen combined-mode line chart for PDF embedding.
 * `series` = { labels, data } from KCCharts.dailySeries.
 * `markers` = optional [{index, count}] for terracotta seizure-day dots along baseline.
 * Y-axis auto-fits both data and target band so values above the band stay visible.
 */
async function renderOffscreenCombinedLineChartToPDF(doc, title, y, margin, pageW, series, color, targetBand, markers) {
  const imgW = pageW - margin * 2;
  const imgH = 60;

  if (y + imgH + 10 > 280) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += 4;

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 480;
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0';
  canvas.style.width = '1200px';
  canvas.style.height = '480px';
  document.body.appendChild(canvas);

  try {
    const datasets = [
      {
        label: 'Reading',
        data: series.data,
        borderColor: color,
        backgroundColor: color + '33',
        borderWidth: 2.5,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: color,
        spanGaps: true,
        fill: true,
        order: 1
      }
    ];

    if (targetBand && targetBand.min != null && targetBand.max != null) {
      datasets.push({
        label: '_targetMax',
        data: series.labels.map(() => targetBand.max),
        borderColor: 'transparent',
        backgroundColor: 'rgba(107, 138, 107, 0.18)',
        pointRadius: 0,
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
        fill: false,
        tension: 0,
        order: 99
      });
    }

    if (markers && markers.length) {
      const points = markers.map(m => ({ x: series.labels[m.index], y: 0 }));
      datasets.push({
        label: '_seizureMarkers',
        data: points,
        type: 'scatter',
        borderColor: 'transparent',
        backgroundColor: '#a85a48',
        pointStyle: 'circle',
        pointRadius: 5,
        showLine: false,
        order: 0
      });
    }

    const yMax = KCCharts.suggestedYMax(series.data, targetBand);

    const chart = new Chart(canvas, {
      type: 'line',
      data: { labels: series.labels, datasets },
      options: {
        responsive: false,
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 16 } } },
          y: { beginAtZero: true, suggestedMax: yMax, grid: { color: '#e3d8c5' }, ticks: { font: { size: 16 } } }
        }
      }
    });

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    doc.addImage(dataUrl, 'PNG', margin, y, imgW, imgH);
    chart.destroy();
  } catch (err) {
    console.warn('Chart render failed:', err);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(138, 130, 120);
    doc.text('(Chart not available)', margin, y + 5);
  } finally {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return y + imgH + 6;
}

/**
 * Off-screen AM/PM split line chart for PDF embedding.
 * Used by the Patterns section.
 */
async function renderOffscreenSplitLineChartToPDF(doc, title, y, margin, pageW, series, colorMorning, colorEvening, targetBand, markers) {
  const imgW = pageW - margin * 2;
  const imgH = 60;

  if (y + imgH + 10 > 280) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += 4;

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 520;
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0';
  canvas.style.width = '1200px';
  canvas.style.height = '520px';
  document.body.appendChild(canvas);

  try {
    const datasets = [
      {
        label: 'Morning',
        data: series.morning,
        borderColor: colorMorning,
        backgroundColor: colorMorning + '22',
        borderWidth: 2.5,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: colorMorning,
        spanGaps: true,
        fill: false,
        order: 1
      },
      {
        label: 'Evening',
        data: series.evening,
        borderColor: colorEvening,
        backgroundColor: colorEvening + '22',
        borderWidth: 2.5,
        borderDash: [6, 5],
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: colorEvening,
        spanGaps: true,
        fill: false,
        order: 1
      }
    ];

    if (targetBand && targetBand.min != null && targetBand.max != null) {
      datasets.push({
        label: '_targetMax',
        data: series.labels.map(() => targetBand.max),
        borderColor: 'transparent',
        backgroundColor: 'rgba(107, 138, 107, 0.18)',
        pointRadius: 0,
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
        fill: false,
        tension: 0,
        order: 99
      });
    }

    if (markers && markers.length) {
      const points = markers.map(m => ({ x: series.labels[m.index], y: 0 }));
      datasets.push({
        label: '_seizureMarkers',
        data: points,
        type: 'scatter',
        borderColor: 'transparent',
        backgroundColor: '#a85a48',
        pointStyle: 'circle',
        pointRadius: 5,
        showLine: false,
        order: 0
      });
    }

    const allVals = [...series.morning, ...series.evening];
    const yMax = KCCharts.suggestedYMax(allVals, targetBand);

    const chart = new Chart(canvas, {
      type: 'line',
      data: { labels: series.labels, datasets },
      options: {
        responsive: false,
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              boxWidth: 18, boxHeight: 14, padding: 16, font: { size: 16 },
              filter: (item) => !item.text || !item.text.startsWith('_')
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 16 } } },
          y: { beginAtZero: true, suggestedMax: yMax, grid: { color: '#e3d8c5' }, ticks: { font: { size: 16 } } }
        }
      }
    });

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    doc.addImage(dataUrl, 'PNG', margin, y, imgW, imgH);
    chart.destroy();
  } catch (err) {
    console.warn('Chart render failed:', err);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(138, 130, 120);
    doc.text('(Chart not available)', margin, y + 5);
  } finally {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return y + imgH + 6;
}

/**
 * Render the AM/PM stats table that appears at the top of the Patterns
 * section. Uses jsPDF's text primitives — small enough that we don't need
 * to off-screen render a HTML table.
 */
function renderPatternsStatsTable(doc, margin, y, pageW, measurements, seizures, fromMs, toMs) {
  const MORNING_END = KCCharts.MORNING_END_HOUR;
  const isMorning = (ts) => new Date(ts).getHours() < MORNING_END;

  const amM = measurements.filter(m => isMorning(m.timestamp));
  const pmM = measurements.filter(m => !isMorning(m.timestamp));

  const valsForKey = (records, key) => records
    .filter(m => m[key] != null && !isNaN(m[key])).map(m => m[key]);
  const valsForGKI = (records) => records
    .filter(m => m.bloodKetone && m.glucose && m.bloodKetone > 0)
    .map(m => m.glucose / m.bloodKetone);

  const stats = {
    ketoneAM:  KCCharts.computeStats(valsForKey(amM, 'bloodKetone')),
    ketonePM:  KCCharts.computeStats(valsForKey(pmM, 'bloodKetone')),
    glucoseAM: KCCharts.computeStats(valsForKey(amM, 'glucose')),
    glucosePM: KCCharts.computeStats(valsForKey(pmM, 'glucose')),
    gkiAM:     KCCharts.computeStats(valsForGKI(amM)),
    gkiPM:     KCCharts.computeStats(valsForGKI(pmM))
  };

  const amSeiz = seizures.filter(s => isMorning(s.startTime)).length;
  const pmSeiz = seizures.filter(s => !isMorning(s.startTime)).length;

  // Layout: 5 columns — metric, AM min/max/mean/n, PM min/max/mean/n
  // Compact textual presentation. Stays simple to keep PDF rendering fast.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(45, 42, 38);

  const colX = [
    margin,                  // metric label
    margin + 50,             // AM min
    margin + 65,             // AM max
    margin + 80,             // AM mean
    margin + 95,             // AM readings
    margin + 115,            // PM min
    margin + 130,            // PM max
    margin + 145,            // PM mean
    margin + 160             // PM readings
  ];

  // Header row 1 — AM / PM groupings
  doc.setFontSize(8);
  doc.setTextColor(138, 130, 120);
  doc.text('AM', colX[1] + 22, y, { align: 'center' });
  doc.text('PM', colX[5] + 22, y, { align: 'center' });
  y += 3;

  // Header row 2 — column titles
  const subHeads = ['min', 'max', 'mean', 'n', 'min', 'max', 'mean', 'n'];
  subHeads.forEach((h, i) => {
    doc.text(h, colX[i + 1], y, { align: 'left' });
  });
  y += 4;

  // Light separator line
  doc.setDrawColor(227, 216, 197);
  doc.setLineWidth(0.2);
  doc.line(margin, y - 1, margin + (pageW - margin * 2), y - 1);
  y += 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(45, 42, 38);

  const writeRow = (label, am, pm) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, colX[0], y);
    doc.setFont('helvetica', 'normal');
    [am.min, am.max, am.mean, am.count, pm.min, pm.max, pm.mean, pm.count]
      .forEach((v, i) => doc.text(String(v), colX[i + 1], y));
    y += 5;
  };

  writeRow('Ketone',  stats.ketoneAM,  stats.ketonePM);
  writeRow('Glucose', stats.glucoseAM, stats.glucosePM);
  writeRow('GKI',     stats.gkiAM,     stats.gkiPM);

  // Seizures row — different shape (just total + per day)
  doc.setFont('helvetica', 'bold');
  doc.text('Seizures', colX[0], y);
  doc.setFont('helvetica', 'normal');
  doc.text(`total ${amSeiz}`, colX[1], y);
  doc.text(`total ${pmSeiz}`, colX[5], y);
  y += 7;

  return y;
}

/**
 * v1.3 — Compact "Seizures by type" list. Sits in the Patterns section just
 * below the AM/PM stats table. One row per type, count right-aligned.
 * Returns the updated y. Returns y unchanged if no seizures in range.
 */
function renderPatternsTypeCountList(doc, margin, y, pageW, seizures, settings) {
  if (!seizures || !seizures.length) return y;
  const counts = KCCharts.seizureTypeCounts(seizures, settings);
  if (!counts.length) return y;

  // Page-break safety
  const lineH = 5;
  const needed = 8 + counts.length * lineH + 4;
  if (y + needed > 280) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(45, 42, 38);
  doc.text('Seizures by type', margin, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const rightX = margin + (pageW - margin * 2);
  const total = counts.reduce((a, c) => a + c.count, 0);

  for (const c of counts) {
    doc.text(c.label, margin, y);
    doc.text(String(c.count), rightX, y, { align: 'right' });
    y += lineH;
  }

  // Total separator
  doc.setDrawColor(227, 216, 197);
  doc.setLineWidth(0.2);
  doc.line(margin, y - 2.5, rightX, y - 2.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Total events', margin, y);
  doc.text(String(total), rightX, y, { align: 'right' });
  y += 6;

  return y;
}

/**
 * v1.3 — Render a small-multiples grid of one mini-chart per seizure type
 * to the PDF. Used for both Frequency and Duration views.
 *
 * `typesData` is the array returned by seizureTypeFrequencyByType /
 * seizureTypeDurationByType.
 * `mode` is 'frequency' or 'duration'.
 */
async function renderSeizureTypesGridToPDF(doc, title, y, margin, pageW, typesData, mode) {
  if (!typesData || !typesData.length) return y;

  const cols = 2;
  const gap = 4;
  const innerW = pageW - margin * 2;
  const cellW = (innerW - gap * (cols - 1)) / cols;
  const cellH = 38;
  const canvasInsetY = 7;
  const canvasH = cellH - canvasInsetY - 2;
  const titleH = 7;

  if (y + titleH + cellH + 6 > 280) { doc.addPage(); y = margin; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += titleH;

  for (let i = 0; i < typesData.length; i += cols) {
    if (y + cellH > 280) { doc.addPage(); y = margin; }

    for (let c = 0; c < cols; c++) {
      const idx = i + c;
      if (idx >= typesData.length) break;
      const t = typesData[idx];
      const cellX = margin + c * (cellW + gap);

      // Per-cell header line — type label + total
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(45, 42, 38);
      const labelMax = cellW - 22;
      let label = t.label;
      if (doc.getTextWidth(label) > labelMax) {
        while (label.length > 1 && doc.getTextWidth(label + '…') > labelMax) {
          label = label.slice(0, -1);
        }
        label = label + '…';
      }
      doc.text(label, cellX, y + 3);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(138, 130, 120);
      const subN = mode === 'duration' ? t.totalWithDuration : t.total;
      const subLabel = mode === 'duration' ? `n=${subN} timed` : `n=${subN}`;
      doc.text(subLabel, cellX + cellW, y + 3, { align: 'right' });

      const dataUrl = await _renderTypeMiniToPNG(t.buckets, KCCharts.COLORS.terraDeep, mode);
      if (dataUrl) {
        doc.addImage(dataUrl, 'PNG', cellX, y + canvasInsetY, cellW, canvasH);
      } else {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(138, 130, 120);
        doc.text('(Chart not available)', cellX, y + canvasInsetY + 5);
      }
    }

    y += cellH + 2;
  }

  return y + 2;
}

/**
 * Off-screen render one mini-chart and return its PNG data URL.
 * Kept in sync with seizureTypeSmallMultipleChart() in charts.js, with
 * larger fonts for print legibility.
 */
async function _renderTypeMiniToPNG(buckets, color, mode) {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 260;
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0';
  canvas.style.width = '600px';
  canvas.style.height = '260px';
  document.body.appendChild(canvas);

  const fmtDur = (s) => {
    if (s == null) return '—';
    const r = Math.round(s);
    const m = Math.floor(r / 60);
    const rs = r % 60;
    return `${m}:${String(rs).padStart(2, '0')}`;
  };

  try {
    const labels = buckets.map(b => b.label);
    let datasets;
    let yMax;

    if (mode === 'duration') {
      const barData = buckets.map(b => (b.count >= 3 && b.median != null) ? b.median : null);
      const dotPoints = [];
      buckets.forEach((b, i) => {
        if (b.count > 0 && b.count < 3) {
          b.durations.forEach(d => { if (d != null) dotPoints.push({ x: labels[i], y: d }); });
        }
      });
      datasets = [
        { type: 'bar', data: barData, backgroundColor: color, borderRadius: 4, maxBarThickness: 36 },
        { type: 'scatter', data: dotPoints, backgroundColor: color, borderColor: '#fffaf2', borderWidth: 1, pointRadius: 5, showLine: false }
      ];
      const allDur = [...barData.filter(v => v != null), ...dotPoints.map(p => p.y)];
      yMax = allDur.length ? Math.max(...allDur) * 1.15 : 60;
      if (yMax < 30) yMax = 30;
    } else {
      const counts = buckets.map(b => b.count);
      datasets = [{ type: 'bar', data: counts, backgroundColor: color, borderRadius: 4, maxBarThickness: 36 }];
      const maxCount = counts.length ? Math.max(...counts, 1) : 1;
      yMax = Math.max(maxCount + 1, 3);
    }

    const chart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: false,
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 14 } } },
          y: {
            beginAtZero: true,
            suggestedMax: yMax,
            ticks: {
              stepSize: mode === 'duration' ? undefined : 1,
              precision: mode === 'duration' ? undefined : 0,
              font: { size: 14 },
              callback: mode === 'duration' ? (v) => fmtDur(v) : undefined
            },
            grid: { color: '#e3d8c5' }
          }
        }
      }
    });

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    chart.destroy();
    return dataUrl;
  } catch (err) {
    console.warn('Type mini-chart render failed:', err);
    return null;
  } finally {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }
}

/**
 * Render the day-of-week heatmap directly using jsPDF rectangles.
 * Avoids the off-screen Chart.js path because there's no Chart.js
 * heatmap type in this build, and html2canvas would add a heavy dep.
 *
 * `weekly` = output of KCCharts.weeklyHeatmap.
 */
function renderHeatmapToPDF(doc, title, y, margin, pageW, weekly) {
  const dayHeads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const orderedWeeks = [...weekly.weeks].reverse();
  const labelW = 14; // mm — width of the row-label column
  const usableW = pageW - margin * 2;
  const cellW = (usableW - labelW) / 7;
  const cellH = 5; // mm — short to keep the heatmap compact
  const headH = 4; // header row height
  const totalH = headH + orderedWeeks.length * cellH + 6;

  // Page break if needed
  if (y + totalH > 280) { doc.addPage(); y = margin; }

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += 4;

  // Day-of-week headers (Mon..Sun centred above each column)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(138, 130, 120);
  for (let i = 0; i < 7; i++) {
    const cx = margin + labelW + cellW * (i + 0.5);
    doc.text(dayHeads[i], cx, y, { align: 'center' });
  }
  y += 2.5;

  const max = weekly.maxCount || 1;

  for (const w of orderedWeeks) {
    // Row label: week-start date
    doc.setFontSize(7);
    doc.setTextColor(138, 130, 120);
    const d = new Date(w.weekStartMs);
    const lbl = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    doc.text(lbl, margin + labelW - 1, y + cellH * 0.7, { align: 'right' });

    for (let i = 0; i < 7; i++) {
      const cell = w.days[i];
      const cx = margin + labelW + cellW * i + 0.4;
      const cy = y + 0.4;
      const cw = cellW - 0.8;
      const ch = cellH - 0.8;
      if (!cell.inRange) continue; // empty/transparent
      if (cell.count === 0) {
        // Light cream cell with line border to match in-app surface look
        doc.setDrawColor(227, 216, 197);
        doc.setFillColor(255, 250, 242);
        doc.roundedRect(cx, cy, cw, ch, 0.7, 0.7, 'FD');
      } else {
        // Terracotta with opacity proportional to count.
        // jsPDF doesn't do RGBA, so we mix toward the cream background manually.
        // Background cream: (244, 237, 226). Terracotta-deep: (168, 90, 72).
        const ratio = Math.min(1, 0.20 + (cell.count / max) * 0.75);
        const bg = [244, 237, 226], fg = [168, 90, 72];
        const r = Math.round(bg[0] + (fg[0] - bg[0]) * ratio);
        const g = Math.round(bg[1] + (fg[1] - bg[1]) * ratio);
        const b = Math.round(bg[2] + (fg[2] - bg[2]) * ratio);
        doc.setFillColor(r, g, b);
        doc.setDrawColor(r, g, b);
        doc.roundedRect(cx, cy, cw, ch, 0.7, 0.7, 'FD');
        // Count label — white text on darker cells, ink on lighter
        doc.setFontSize(7);
        if (ratio > 0.55) doc.setTextColor(255, 250, 242);
        else doc.setTextColor(45, 42, 38);
        doc.text(String(cell.count), cx + cw / 2, cy + ch * 0.72, { align: 'center' });
      }
    }
    y += cellH;
  }

  // Footnote
  y += 2;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(138, 130, 120);
  doc.text('Each cell shows the number of seizures logged on that day. Darker = more.', margin, y);

  return y + 5;
}

/**
 * Off-screen horizontal bar chart for PDF embedding (used by triggers tally).
 */
async function renderOffscreenHorizontalBarChartToPDF(doc, title, y, margin, pageW, labels, data, color) {
  const imgW = pageW - margin * 2;
  // Height scales with number of bars but capped
  const imgH = Math.min(70, 18 + labels.length * 6);

  if (y + imgH + 14 > 280) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += 4;

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  // Canvas height also scales with bar count, generous to keep labels legible
  canvas.height = Math.min(700, 200 + labels.length * 40);
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0';
  canvas.style.width = '1200px';
  canvas.style.height = canvas.height + 'px';
  document.body.appendChild(canvas);

  try {
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: color,
          borderRadius: 4,
          maxBarThickness: 30
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, precision: 0, font: { size: 16 } }, grid: { color: '#e3d8c5' } },
          y: { grid: { display: false }, ticks: { font: { size: 16 } } }
        }
      }
    });

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    doc.addImage(dataUrl, 'PNG', margin, y, imgW, imgH);
    chart.destroy();
  } catch (err) {
    console.warn('Chart render failed:', err);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(138, 130, 120);
    doc.text('(Chart not available)', margin, y + 5);
  } finally {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  // Footnote
  y += imgH + 3;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(138, 130, 120);
  doc.text('Trigger instances logged across all seizures. Each seizure can have multiple triggers.', margin, y);

  return y + 5;
}

/**
 * Off-screen bar chart for PDF embedding (used by seizure frequency).
 */
async function renderOffscreenBarChartToPDF(doc, title, y, margin, pageW, labels, data, color) {
  const imgW = pageW - margin * 2;
  const imgH = 55;

  if (y + imgH + 10 > 280) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += 4;

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 480;
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0';
  canvas.style.width = '1200px';
  canvas.style.height = '480px';
  document.body.appendChild(canvas);

  try {
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: color,
          borderRadius: 6,
          maxBarThickness: 28
        }]
      },
      options: {
        responsive: false,
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 16 } } },
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0, font: { size: 16 } }, grid: { color: '#e3d8c5' } }
        }
      }
    });

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    doc.addImage(dataUrl, 'PNG', margin, y, imgW, imgH);
    chart.destroy();
  } catch (err) {
    console.warn('Chart render failed:', err);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(138, 130, 120);
    doc.text('(Chart not available)', margin, y + 5);
  } finally {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return y + imgH + 6;
}

/**
 * Off-screen 24-hour histogram for PDF embedding.
 * `data` = 24-element count array from KCCharts.seizuresByHour.
 * Mirrors the in-app hourHistogramChart styling (sparse axis labels at 0/6/12/18).
 */
async function renderOffscreenHourHistogramToPDF(doc, title, y, margin, pageW, data, color) {
  const imgW = pageW - margin * 2;
  const imgH = 50;

  if (y + imgH + 14 > 280) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += 4;

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 380;
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0';
  canvas.style.width = '1200px';
  canvas.style.height = '380px';
  document.body.appendChild(canvas);

  try {
    const labels = data.map((_, h) => String(h));
    const majorTicks = new Set([0, 6, 12, 18]);

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: color,
          borderRadius: 4,
          maxBarThickness: 18
        }]
      },
      options: {
        responsive: false,
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 0,
              autoSkip: false,
              font: { size: 16 },
              callback: function(_, index) {
                return majorTicks.has(index) ? `${index}:00` : '';
              }
            }
          },
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0, font: { size: 16 } }, grid: { color: '#e3d8c5' } }
        }
      }
    });

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    doc.addImage(dataUrl, 'PNG', margin, y, imgW, imgH);
    chart.destroy();
  } catch (err) {
    console.warn('Chart render failed:', err);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(138, 130, 120);
    doc.text('(Chart not available)', margin, y + 5);
  } finally {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  // Small descriptive footnote under the histogram
  y += imgH + 3;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(138, 130, 120);
  doc.text('Descriptive only — there is no established time-of-day pattern in research.', margin, y);

  return y + 5;
}

function formatVariant(v, settings) {
  const map = {
    'classical-4-1': 'Classical 4:1',
    'classical-3-1': 'Classical 3:1',
    'classical-2-1': 'Classical 2:1',
    'mct': 'MCT',
    'mkd': 'Modified Ketogenic Diet (MKD)',
    'mad': 'Modified Atkins (MAD)',
    'lgit': 'LGIT'
  };
  if (v === 'custom') {
    const r = settings && settings.customRatio ? settings.customRatio : '';
    return r ? `Custom (${r})` : 'Custom';
  }
  return map[v] || v || '—';
}

/**
 * Format a seizure record's type for export. Handles:
 *   - 'custom:N' values that reference settings.customSeizureTypes[N]
 *   - 'other' values that may have a free-text typeOther description
 *   - Standard values, capitalised
 */
function formatSeizureType(s, settings) {
  if (!s || !s.type) return '';
  if (s.type === 'other') {
    return s.typeOther && s.typeOther.trim() ? s.typeOther : 'Other';
  }
  if (typeof s.type === 'string' && s.type.startsWith('custom:')) {
    const idx = parseInt(s.type.split(':')[1], 10);
    const list = (settings && settings.customSeizureTypes) || [];
    return list[idx] || 'Custom';
  }
  return s.type.charAt(0).toUpperCase() + s.type.slice(1);
}

function urineLabel(v) {
  if (v === 0)  return 'Negative';
  if (v <= 0.5) return 'Trace';
  if (v <= 1.5) return 'Small (+)';
  if (v <= 4)   return 'Moderate (++)';
  if (v <= 8)   return 'Large (+++)';
  return 'Very large (++++)';
}

window.KCExport = {
  exportXLSX, exportJSON, exportPDF, formatVariant, formatSeizureType, urineLabel
};
