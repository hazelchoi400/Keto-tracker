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
  const seizSheet = buildSeizuresSheet(seizures, measurements);
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

  // Most common seizure type
  const typeCount = {};
  for (const s of seizures) if (s.type) typeCount[s.type] = (typeCount[s.type] || 0) + 1;
  const topType = Object.keys(typeCount).sort((a, b) => typeCount[b] - typeCount[a])[0] || '—';

  const totalDays = Math.max(1, Math.round((toMs - fromMs) / 86400000));

  const rows = [
    ['KetoCare summary', ''],
    ['', ''],
    ['Child', settings.childName || '—'],
    ['Date of birth', settings.dob || '—'],
    ['Diet variant', formatVariant(settings.variant)],
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

function buildSeizuresSheet(seizures, measurements) {
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
      capitalise(s.type || ''),
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
    ['  Diet variant    ' + formatVariant(settings.variant)],
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
  doc.text(formatVariant(settings.variant), MARGIN + 30, y);
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

  // Charts — render fresh to off-screen canvases so this works regardless of which screen the user is on
  const ketoneSeries  = KCCharts.dailyAverages(measurements, 'bloodKetone', fromMs, toMs);
  const glucoseSeries = KCCharts.dailyAverages(measurements, 'glucose', fromMs, toMs);
  const gkiSeries     = KCCharts.dailyAverages(
    measurements,
    (r) => (r.bloodKetone && r.glucose && r.bloodKetone > 0 ? r.glucose / r.bloodKetone : null),
    fromMs, toMs
  );
  const seizureSeries = KCCharts.dailyCounts(seizures, fromMs, toMs);

  y = await renderOffscreenChartToPDF(doc, 'Ketone trend (mmol/L)', y, MARGIN, PAGE_W,
    'line', ketoneSeries.labels, ketoneSeries.data, KCCharts.COLORS.sageDeep,
    (settings.ketoneMin && settings.ketoneMax) ? { min: settings.ketoneMin, max: settings.ketoneMax } : null);
  y = await renderOffscreenChartToPDF(doc, 'Glucose trend (mmol/L)', y, MARGIN, PAGE_W,
    'line', glucoseSeries.labels, glucoseSeries.data, KCCharts.COLORS.honey, null);
  y = await renderOffscreenChartToPDF(doc, 'GKI trend', y, MARGIN, PAGE_W,
    'line', gkiSeries.labels, gkiSeries.data, KCCharts.COLORS.terra,
    (settings.gkiMin != null && settings.gkiMax != null) ? { min: settings.gkiMin, max: settings.gkiMax } : null);
  y = await renderOffscreenChartToPDF(doc, 'Seizure frequency', y, MARGIN, PAGE_W,
    'bar', seizureSeries.labels, seizureSeries.data, KCCharts.COLORS.terraDeep, null);

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
      const parts = [`SEIZURE — ${s.type || 'unspecified'}`];
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

async function renderOffscreenChartToPDF(doc, title, y, margin, pageW, chartType, labels, data, color, targetBand) {
  const imgW = pageW - margin * 2;
  const imgH = 55;

  if (y + imgH + 10 > 280) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += 4;

  // Off-screen canvas — high resolution for sharp PDF embedding
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 480;
  // Must attach to DOM so Chart.js can size correctly, but keep it invisible
  canvas.style.position = 'fixed';
  canvas.style.left = '-9999px';
  canvas.style.top = '0';
  canvas.style.width = '1200px';
  canvas.style.height = '480px';
  document.body.appendChild(canvas);

  try {
    const datasets = [{
      data,
      borderColor: color,
      backgroundColor: color + '33',
      borderWidth: chartType === 'line' ? 2.5 : 0,
      tension: 0.35,
      pointRadius: chartType === 'line' ? 3 : 0,
      pointBackgroundColor: color,
      spanGaps: true,
      fill: chartType === 'line',
      borderRadius: chartType === 'bar' ? 6 : 0,
      maxBarThickness: 28
    }];

    if (chartType === 'line' && targetBand && targetBand.min != null && targetBand.max != null) {
      datasets.push({
        data: data.map(() => targetBand.max),
        borderColor: 'transparent',
        backgroundColor: 'rgba(107, 138, 107, 0.18)',
        pointRadius: 0,
        fill: { target: { value: targetBand.min }, above: 'rgba(107, 138, 107, 0.18)', below: 'transparent' }
      });
    }

    const chart = new Chart(canvas, {
      type: chartType,
      data: { labels, datasets },
      options: {
        responsive: false,
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 16 } } },
          y: { beginAtZero: true, grid: { color: '#e3d8c5' }, ticks: { font: { size: 16 } } }
        }
      }
    });

    // Force a synchronous render by waiting one animation frame, then capture
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

  y += imgH + 6;
  return y;
}

function formatVariant(v) {
  const map = {
    'classical-4-1': 'Classical 4:1',
    'classical-3-1': 'Classical 3:1',
    'classical-2-1': 'Classical 2:1',
    'mct': 'MCT',
    'mad': 'Modified Atkins (MAD)',
    'lgit': 'LGIT'
  };
  return map[v] || v || '—';
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
  exportXLSX, exportJSON, exportPDF, formatVariant, urineLabel
};
