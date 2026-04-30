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

async function exportCSV(fromMs, toMs) {
  const settings = await KCDB.getSettings();
  const measurements = await KCDB.getMeasurementsBetween(fromMs, toMs);
  const seizures = await KCDB.getSeizuresBetween(fromMs, toMs);

  // Sort everything chronologically — most analysis assumes this
  measurements.sort((a, b) => a.timestamp - b.timestamp);
  seizures.sort((a, b) => a.startTime - b.startTime);

  // Find the earliest record across both — used as study epoch (days_since_start = 0)
  const allMs = [
    ...measurements.map(m => m.timestamp),
    ...seizures.map(s => s.startTime)
  ];
  // Anchor epoch to the START of the first calendar day so days_since_start is never negative
  let epochMs;
  if (allMs.length) {
    const earliest = new Date(Math.min(...allMs));
    earliest.setHours(0, 0, 0, 0);
    epochMs = earliest.getTime();
  } else {
    const start = new Date(fromMs);
    start.setHours(0, 0, 0, 0);
    epochMs = start.getTime();
  }

  const childId = (settings.childName || 'child').replace(/\s+/g, '_').toLowerCase() || 'child';

  // ---------- measurements.csv ----------
  const measHeader = [
    'record_id', 'child_id',
    'timestamp_iso', 'timestamp_unix_ms',
    'date', 'time_of_day', 'hour_of_day', 'day_of_week', 'days_since_start',
    'ketone_method', 'blood_ketone_mmol_l', 'urine_ketone_mmol_l',
    'glucose_mmol_l', 'gki',
    'in_target_ketone', 'in_target_gki',
    'notes'
  ];
  const measRows = [measHeader];
  for (const m of measurements) {
    const d = new Date(m.timestamp);
    const method = m.bloodKetone != null ? 'blood' : (m.urineKetone != null ? 'urine' : '');
    const gki = (m.bloodKetone && m.glucose && m.bloodKetone > 0)
      ? +(m.glucose / m.bloodKetone).toFixed(3) : '';
    const inTargetK = inRange(m.bloodKetone, settings.ketoneMin, settings.ketoneMax);
    const inTargetG = inRange(gki || null, settings.gkiMin, settings.gkiMax);
    measRows.push([
      m.id ?? '',
      childId,
      d.toISOString(),
      m.timestamp,
      isoDate(d),
      isoTime(d),
      d.getHours(),
      d.getDay(),
      daysBetween(epochMs, m.timestamp),
      method,
      m.bloodKetone ?? '',
      m.urineKetone ?? '',
      m.glucose ?? '',
      gki,
      inTargetK,
      inTargetG,
      m.notes || ''
    ]);
  }

  // ---------- seizures.csv ----------
  const TRIGGER_TYPES = ['illness', 'missed-meal', 'poor-sleep', 'stress', 'heat', 'unknown', 'other'];
  const triggerCols = TRIGGER_TYPES.map(t => 'trigger_' + t.replace('-', '_'));

  const seizHeader = [
    'record_id', 'child_id',
    'start_iso', 'start_unix_ms',
    'date', 'time_of_day', 'hour_of_day', 'day_of_week', 'days_since_start',
    'duration_sec', 'duration_min', 'seizure_type',
    'n_triggers', ...triggerCols,
    'rescue_med_given', 'rescue_med_text',
    'recovery_min',
    'prev_blood_ketone_mmol_l', 'prev_ketone_hours_before',
    'prev_glucose_mmol_l', 'prev_gki',
    'next_blood_ketone_mmol_l', 'next_ketone_hours_after',
    'notes'
  ];
  const seizRows = [seizHeader];

  for (const s of seizures) {
    const d = new Date(s.startTime);
    const triggers = s.triggers || [];
    const oneHot = TRIGGER_TYPES.map(t => triggers.includes(t) ? 1 : 0);

    // Find nearest blood-ketone measurements before and after
    const prevMeas = findNearestBefore(measurements, s.startTime, m => m.bloodKetone != null);
    const nextMeas = findNearestAfter(measurements, s.startTime, m => m.bloodKetone != null);

    seizRows.push([
      s.id ?? '',
      childId,
      d.toISOString(),
      s.startTime,
      isoDate(d),
      isoTime(d),
      d.getHours(),
      d.getDay(),
      daysBetween(epochMs, s.startTime),
      s.durationSec ?? 0,
      s.durationSec ? +(s.durationSec / 60).toFixed(2) : 0,
      s.type || '',
      triggers.length,
      ...oneHot,
      s.rescueMed ? 1 : 0,
      s.rescueMed || '',
      s.recoveryMin ?? '',
      prevMeas ? prevMeas.bloodKetone : '',
      prevMeas ? +((s.startTime - prevMeas.timestamp) / 3600000).toFixed(2) : '',
      prevMeas?.glucose ?? '',
      (prevMeas && prevMeas.bloodKetone && prevMeas.glucose)
        ? +(prevMeas.glucose / prevMeas.bloodKetone).toFixed(3) : '',
      nextMeas ? nextMeas.bloodKetone : '',
      nextMeas ? +((nextMeas.timestamp - s.startTime) / 3600000).toFixed(2) : '',
      s.notes || ''
    ]);
  }

  // ---------- daily_summary.csv ----------
  // Bucket by calendar day
  const dayMap = {};
  function bucket(date) {
    const d = new Date(date); d.setHours(0,0,0,0);
    const key = d.getTime();
    if (!dayMap[key]) {
      dayMap[key] = { date: d, n_records: 0, ketones: [], glucoses: [], gkis: [], firstK: null, lastK: null, seizures: [] };
    }
    return dayMap[key];
  }
  for (const m of measurements) {
    const b = bucket(m.timestamp);
    b.n_records++;
    if (m.bloodKetone != null) {
      b.ketones.push(m.bloodKetone);
      if (b.firstK === null || m.timestamp < b.firstK.t) b.firstK = { t: m.timestamp, v: m.bloodKetone };
      if (b.lastK  === null || m.timestamp > b.lastK.t)  b.lastK  = { t: m.timestamp, v: m.bloodKetone };
    }
    if (m.glucose != null) b.glucoses.push(m.glucose);
    if (m.bloodKetone && m.glucose && m.bloodKetone > 0) b.gkis.push(m.glucose / m.bloodKetone);
  }
  for (const s of seizures) bucket(s.startTime).seizures.push(s);

  const dailyHeader = [
    'date', 'day_of_week', 'days_since_start',
    'n_measurements', 'n_seizures', 'total_seizure_duration_sec', 'seizure_occurred',
    'blood_ketone_min', 'blood_ketone_max', 'blood_ketone_mean', 'blood_ketone_median',
    'blood_ketone_first_of_day', 'blood_ketone_last_of_day',
    'glucose_min', 'glucose_max', 'glucose_mean', 'glucose_median',
    'gki_min', 'gki_max', 'gki_mean', 'gki_median'
  ];
  const dailyRows = [dailyHeader];
  Object.keys(dayMap).sort((a, b) => +a - +b).forEach(k => {
    const b = dayMap[k];
    const seizDur = b.seizures.reduce((a, s) => a + (s.durationSec || 0), 0);
    const kStats = numericStats(b.ketones);
    const gStats = numericStats(b.glucoses);
    const giStats = numericStats(b.gkis);
    dailyRows.push([
      isoDate(b.date),
      b.date.getDay(),
      daysBetween(epochMs, b.date.getTime()),
      b.n_records,
      b.seizures.length,
      seizDur,
      b.seizures.length > 0 ? 1 : 0,
      kStats.min, kStats.max, kStats.mean, kStats.median,
      b.firstK ? b.firstK.v : '',
      b.lastK  ? b.lastK.v  : '',
      gStats.min, gStats.max, gStats.mean, gStats.median,
      giStats.min, giStats.max, giStats.mean, giStats.median
    ]);
  });

  // ---------- README ----------
  const readme = generateDataReadme(settings, fromMs, toMs, measurements.length, seizures.length, epochMs);

  // Bundle into a zip
  if (!window.JSZip) {
    // Fallback: download just measurements.csv if zip lib unavailable
    const csv = measRows.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `ketocare_measurements_${fmtDateISO(fromMs)}_to_${fmtDateISO(toMs)}.csv`);
    return;
  }

  const zip = new JSZip();
  zip.file('measurements.csv',   measRows.map(r => r.map(csvEscape).join(',')).join('\n'));
  zip.file('seizures.csv',       seizRows.map(r => r.map(csvEscape).join(',')).join('\n'));
  zip.file('daily_summary.csv',  dailyRows.map(r => r.map(csvEscape).join(',')).join('\n'));
  zip.file('README_data.txt',    readme);

  const content = await zip.generateAsync({ type: 'blob' });
  const filename = `ketocare_data_${(settings.childName || 'export').replace(/\s+/g,'_')}_${fmtDateISO(fromMs)}_to_${fmtDateISO(toMs)}.zip`;
  downloadBlob(content, filename);
}

/* ---------- helpers for the research export ---------- */

function isoDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function isoTime(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function daysBetween(fromMs, toMs) {
  return Math.floor((toMs - fromMs) / 86400000);
}
function inRange(v, min, max) {
  if (v == null || v === '' || isNaN(v)) return '';
  if (min == null || max == null) return '';
  return (v >= min && v <= max) ? 'TRUE' : 'FALSE';
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
function numericStats(vals) {
  if (!vals.length) return { min: '', max: '', mean: '', median: '' };
  const sorted = [...vals].sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  return {
    min: +sorted[0].toFixed(2),
    max: +sorted[sorted.length-1].toFixed(2),
    mean: +(sum / vals.length).toFixed(2),
    median: +median.toFixed(2)
  };
}

function generateDataReadme(settings, fromMs, toMs, nMeas, nSeiz, epochMs) {
  return `KetoCare data export
=====================

Child name:    ${settings.childName || '(not set)'}
Diet variant:  ${formatVariant(settings.variant)}
Period:        ${fmtDateISO(fromMs)} to ${fmtDateISO(toMs)}
Generated:     ${new Date().toISOString()}
Epoch (day 0): ${new Date(epochMs).toISOString()}
Records:       ${nMeas} measurements, ${nSeiz} seizures

This export contains tidy-format data suitable for analysis in R, Python,
SPSS, Stata or Excel. One row per observation, one variable per column.

FILES
-----

  measurements.csv     One row per ketone/glucose measurement.
  seizures.csv         One row per seizure event, with linked nearest
                       measurements (prev_/next_) for time-proximity
                       analysis of the ketone–seizure relationship.
  daily_summary.csv    One row per calendar day. Useful for time-series
                       and rolling-window analyses.

COLUMN REFERENCE — measurements.csv
-----------------------------------
  record_id              Internal unique ID
  child_id               Pseudonymous child ID (currently from name field)
  timestamp_iso          ISO 8601 timestamp, local time with offset
  timestamp_unix_ms      Milliseconds since 1970-01-01 UTC
  date                   YYYY-MM-DD
  time_of_day            HH:MM:SS, 24h
  hour_of_day            0–23
  day_of_week            0=Sun, 1=Mon … 6=Sat
  days_since_start       Days since the earliest record in this export
  ketone_method          'blood' or 'urine' (or empty if neither logged)
  blood_ketone_mmol_l    Blood β-hydroxybutyrate, mmol/L
  urine_ketone_mmol_l    Numeric equivalent of urine strip reading:
                           0 = Negative
                           0.5 = Trace
                           1.5 = Small (+)
                           4 = Moderate (++)
                           8 = Large (+++)
                           16 = Very large (++++)
  glucose_mmol_l         Capillary glucose, mmol/L
  gki                    Glucose-Ketone Index = glucose / blood_ketone
  in_target_ketone       TRUE/FALSE based on user's configured target range
                         (empty if no range set or no ketone value)
  in_target_gki          TRUE/FALSE based on user's configured GKI target range
  notes                  Free-text notes by the parent

COLUMN REFERENCE — seizures.csv
-------------------------------
  record_id, child_id, start_iso, start_unix_ms, date, time_of_day,
  hour_of_day, day_of_week, days_since_start
                         (as above, for the seizure start time)
  duration_sec           Seizure duration in seconds
  duration_min           Same in minutes (2 dp)
  seizure_type           One of: tonic-clonic, absence, myoclonic,
                         focal, drop, other
  n_triggers             Count of triggers selected
  trigger_illness        1 if 'illness' selected, else 0
  trigger_missed_meal    1/0
  trigger_poor_sleep     1/0
  trigger_stress         1/0
  trigger_heat           1/0
  trigger_unknown        1/0
  trigger_other          1/0
  rescue_med_given       1 if any rescue medication recorded, else 0
  rescue_med_text        Free-text description (drug, dose)
  recovery_min           Minutes to baseline (parent's report)
  prev_blood_ketone_mmol_l    Most recent blood ketone BEFORE the seizure
  prev_ketone_hours_before    Hours between that measurement and seizure start
  prev_glucose_mmol_l         Glucose at that same prior measurement
  prev_gki                    GKI at that same prior measurement
  next_blood_ketone_mmol_l    First blood ketone AFTER the seizure
  next_ketone_hours_after     Hours from seizure start to that measurement
  notes                  Free-text notes

COLUMN REFERENCE — daily_summary.csv
------------------------------------
  date, day_of_week, days_since_start    (as above)
  n_measurements             Number of measurement records that day
  n_seizures                 Number of seizures that day
  total_seizure_duration_sec Sum of durations
  seizure_occurred           1 if any seizure that day, else 0
  blood_ketone_{min,max,mean,median}
  blood_ketone_first_of_day  First blood ketone of the calendar day
                             (often the morning fasting reading)
  blood_ketone_last_of_day   Last blood ketone of the calendar day
  glucose_{min,max,mean,median}
  gki_{min,max,mean,median}

NOTES
-----
* Urine ketone is encoded as the mmol/L midpoint of each strip band so it
  can be analysed numerically. Treat with appropriate caution — strip
  readings are ordinal, not interval.
* GKI is only computed when both blood ketone and glucose are recorded.
* Empty cells are missing values, not zeros.
* Timestamps are local time (with offset). For across-time-zone studies,
  use timestamp_unix_ms.
* This data is parent-reported and not clinically validated.

For questions about a particular column or to request additional fields,
contact the app author.
`;
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

  // Charts (rendered from canvas)
  if (document.getElementById('chartKetone')) {
    y = await addChartToPDF(doc, 'chartKetone', 'Ketone trend (mmol/L)', y, MARGIN, PAGE_W);
    y = await addChartToPDF(doc, 'chartGlucose', 'Glucose trend (mmol/L)', y, MARGIN, PAGE_W);
    y = await addChartToPDF(doc, 'chartGKI', 'GKI trend', y, MARGIN, PAGE_W);
    y = await addChartToPDF(doc, 'chartSeizures', 'Seizure frequency', y, MARGIN, PAGE_W);
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

  const filename = `ketocare_summary_${(settings.childName || 'export').replace(/\s+/g,'_')}_${fmtDateISO(fromMs)}_to_${fmtDateISO(toMs)}.pdf`;
  doc.save(filename);
}

async function addChartToPDF(doc, canvasId, title, y, margin, pageW) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return y;

  const imgW = pageW - margin * 2;
  const imgH = 50;

  if (y + imgH + 10 > 280) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  doc.text(title, margin, y);
  y += 4;

  try {
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    doc.addImage(dataUrl, 'PNG', margin, y, imgW, imgH);
  } catch (err) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(138, 130, 120);
    doc.text('(Chart not available)', margin, y + 5);
  }
  y += imgH + 5;
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
  exportCSV, exportJSON, exportPDF, formatVariant, urineLabel
};
