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

  // Tab order is deliberate: ReadMe first so anyone receiving the file
  // cold knows what they're looking at; then Summary (highest level);
  // then Monthly (v1.5: the parent's-spreadsheet view — types as rows,
  // months as columns); then Daily (day-by-day); then the long-format
  // tabs that most cross-sheet analysis joins on; then Patterns data
  // (v1.3) for any clinician wanting the in-app Patterns views as cells.

  // ---------- Tab 1: ReadMe (v1.3) ----------
  const readMeSheet = buildReadMeSheet(settings, fromMs, toMs, measurements.length, seizures.length);
  XLSX.utils.book_append_sheet(wb, readMeSheet, 'ReadMe');

  // ---------- Tab 2: Summary ----------
  const summarySheet = buildSummarySheet(settings, measurements, seizures, fromMs, toMs);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // ---------- Tab 3: Monthly (v1.5) ----------
  // Types-as-rows / months-as-columns view, modelled on the spreadsheets
  // dietitians and neurologists already keep manually at clinic. The bucket
  // type auto-adapts to the export range (daily / weekly / calendar-monthly).
  const periodicSheet = buildPeriodicSheet(settings, measurements, seizures, fromMs, toMs);
  XLSX.utils.book_append_sheet(wb, periodicSheet, 'Monthly');

  // ---------- Tab 4: Daily ----------
  const dailySheet = buildDailySheet(settings, measurements, seizures, fromMs, toMs);
  XLSX.utils.book_append_sheet(wb, dailySheet, 'Daily');

  // ---------- Tab 5: Measurements ----------
  const measSheet = buildMeasurementsSheet(measurements, settings);
  XLSX.utils.book_append_sheet(wb, measSheet, 'Measurements');

  // ---------- Tab 6: Seizures ----------
  const seizSheet = buildSeizuresSheet(seizures, measurements, settings);
  XLSX.utils.book_append_sheet(wb, seizSheet, 'Seizures');

  // ---------- Tab 7: Daily detail (v1.3) ----------
  const detailSheet = buildDailyDetailSheet(measurements, seizures, settings);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Daily detail');

  // ---------- Tab 8: Patterns data (v1.3) ----------
  // Mirrors the in-app Patterns screen as plain cells — no images.
  // Includes AM/PM stats, type counts, per-type weekly counts and
  // median durations, hour-of-day histogram, day-of-week histogram,
  // triggers tally. Bucketing for the per-type matrices is auto-picked
  // from the export range length to match the in-app rules.
  const patternsSheet = buildPatternsSheet(settings, measurements, seizures, fromMs, toMs);
  XLSX.utils.book_append_sheet(wb, patternsSheet, 'Patterns data');

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
    ['Started ketogenic diet', settings.kdStartDate ? fmtDateUK(new Date(settings.kdStartDate + 'T00:00:00').getTime()) : '—'],
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

/**
 * v1.5 — Monthly tab. The parent's-spreadsheet view that clinicians find
 * easiest to read: seizure types as rows, time buckets as columns, totals
 * on the right. Below the type rows, summary rows for ketone (AM/PM mean),
 * glucose mean, GKI mean, readings count, seizure-free days, median
 * duration, and rescue-med uses. Then a blank notes block for the
 * clinician to annotate inline.
 *
 * Bucket choice follows the v1.5 auto-rule:
 *   ≤7 days   → daily
 *   8–60 days → calendar weekly (Mon–Sun)
 *   >60 days  → calendar monthly (Jan, Feb, Mar…)
 *
 * The first and/or last buckets may be partial (e.g. "Apr 23 (from 14)").
 * This matches what the in-app Patterns table shows.
 */
function buildPeriodicSheet(settings, measurements, seizures, fromMs, toMs) {
  const rangeDays = Math.max(1, Math.ceil((toMs - fromMs) / 86400000));
  const { bucket, label: bucketLabel } = KCCharts.autoBucketForDays(rangeDays);

  // Reuse the same type×bucket builder as the in-app Patterns and the PDF.
  const typesTable = KCCharts.seizureTypesByPeriodTable(seizures, settings, fromMs, toMs, bucket);
  const buckets = typesTable.buckets;
  const bucketLabels = buckets.map(b => b.label);

  // Per-bucket helpers — share one pass over events
  const bucketIndex = (ts) => {
    for (let i = 0; i < buckets.length; i++) {
      if (ts >= buckets[i].start && ts <= buckets[i].end) return i;
    }
    return -1;
  };

  // Per-bucket means + counts
  const cells = buckets.map(() => ({
    ketoneAM: [], ketonePM: [], glucose: [], gki: [],
    readings: 0, seizureFreeDays: 0, rescueUses: 0, durations: []
  }));
  // Track unique seizure-days per bucket
  const seizureDaysByBucket = buckets.map(() => new Set());

  const morningEnd = KCCharts.MORNING_END_HOUR;

  for (const m of measurements) {
    const i = bucketIndex(m.timestamp);
    if (i < 0) continue;
    cells[i].readings++;
    const hour = new Date(m.timestamp).getHours();
    if (m.bloodKetone != null && !isNaN(m.bloodKetone)) {
      if (hour < morningEnd) cells[i].ketoneAM.push(m.bloodKetone);
      else cells[i].ketonePM.push(m.bloodKetone);
    }
    if (m.glucose != null && !isNaN(m.glucose)) cells[i].glucose.push(m.glucose);
    if (m.bloodKetone && m.glucose && m.bloodKetone > 0) cells[i].gki.push(m.glucose / m.bloodKetone);
  }

  for (const s of seizures) {
    const i = bucketIndex(s.startTime);
    if (i < 0) continue;
    if (s.durationSec != null && !isNaN(s.durationSec)) cells[i].durations.push(s.durationSec);
    if (s.rescueMed && s.rescueMed.trim()) cells[i].rescueUses++;
    const dayKey = new Date(s.startTime).toDateString();
    seizureDaysByBucket[i].add(dayKey);
  }

  // Compute seizure-free days per bucket = days in bucket − unique seizure days
  for (let i = 0; i < buckets.length; i++) {
    const totalDays = Math.max(1, Math.ceil((buckets[i].end - buckets[i].start + 1) / 86400000));
    cells[i].seizureFreeDays = totalDays - seizureDaysByBucket[i].size;
  }

  const meanOrDash = (arr) => arr.length ? round2(arr.reduce((a, b) => a + b, 0) / arr.length) : '';
  const medianOrDash = (arr) => {
    if (!arr.length) return '';
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : round2((s[mid-1] + s[mid]) / 2);
  };
  const fmtDuration = (secs) => {
    if (secs === '' || secs == null) return '';
    const r = Math.round(secs);
    const m = Math.floor(r / 60);
    const rs = r % 60;
    return `${m}:${String(rs).padStart(2, '0')}`;
  };
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  // Header rows
  const rows = [];
  rows.push([`Monthly summary · ${bucketLabel}`]);
  rows.push([
    settings.kdStartDate
      ? `Started keto ${new Date(settings.kdStartDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
      : ''
  ]);
  rows.push([]); // blank
  rows.push(['', ...bucketLabels, 'Total']);

  // Seizure types — one row per type, then a totals row
  if (typesTable.types.length) {
    for (const t of typesTable.types) {
      const row = [t.label];
      for (const c of t.cells) {
        row.push(c.count > 0 ? c.count : '');
      }
      row.push(t.totalCount);
      rows.push(row);
    }
    // "All seizures" total per bucket
    const allRow = ['All seizures'];
    for (let i = 0; i < buckets.length; i++) {
      const v = typesTable.types.reduce((a, t) => a + (t.cells[i] ? t.cells[i].count : 0), 0);
      allRow.push(v > 0 ? v : '');
    }
    allRow.push(typesTable.types.reduce((a, t) => a + t.totalCount, 0));
    rows.push(allRow);
  } else {
    rows.push(['(no seizures logged in this period)']);
  }

  // Blank row
  rows.push([]);

  // Physiology + treatment summary rows
  const physRow = (label, valuesPerBucket, totalValue) => {
    const r = [label];
    for (const v of valuesPerBucket) r.push(v === '' || v == null ? '' : v);
    r.push(totalValue);
    return r;
  };

  // Compute totals row-by-row from the underlying raw arrays so the Total
  // column is the true grand stat rather than a mean-of-means.
  const allKetoneAM = [].concat(...cells.map(c => c.ketoneAM));
  const allKetonePM = [].concat(...cells.map(c => c.ketonePM));
  const allGlucose  = [].concat(...cells.map(c => c.glucose));
  const allGKI      = [].concat(...cells.map(c => c.gki));
  const allDurations = [].concat(...cells.map(c => c.durations));

  rows.push(physRow('Mean blood ketone — AM (mmol/L)', cells.map(c => meanOrDash(c.ketoneAM)), meanOrDash(allKetoneAM)));
  rows.push(physRow('Mean blood ketone — PM (mmol/L)', cells.map(c => meanOrDash(c.ketonePM)), meanOrDash(allKetonePM)));
  rows.push(physRow('Mean glucose (mmol/L)',           cells.map(c => meanOrDash(c.glucose)),  meanOrDash(allGlucose)));
  rows.push(physRow('Mean GKI',                        cells.map(c => meanOrDash(c.gki)),      meanOrDash(allGKI)));
  rows.push(physRow('Readings logged',                 cells.map(c => c.readings || ''),       sum(cells.map(c => c.readings))));

  // Blank row
  rows.push([]);

  // Treatment / outcome rows
  rows.push(physRow('Seizure-free days',               cells.map(c => c.seizureFreeDays),      sum(cells.map(c => c.seizureFreeDays))));
  rows.push(physRow('Median seizure duration (mm:ss)', cells.map(c => fmtDuration(medianOrDash(c.durations))), fmtDuration(medianOrDash(allDurations))));
  rows.push(physRow('Rescue med uses',                 cells.map(c => c.rescueUses || ''),     sum(cells.map(c => c.rescueUses))));

  // Blank
  rows.push([]);

  // Notes block — empty rows for the clinician to annotate in Excel.
  rows.push(['Notes']);
  for (let i = 0; i < 6; i++) rows.push(['']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Column widths — label column wider, then per-bucket, then Total.
  // Bucket columns get a little extra for partial-month labels like
  // "Apr 23 (from 14)" which are longer than "Apr 23".
  const cols = [{ wch: 36 }];
  for (const b of buckets) cols.push({ wch: Math.max(11, b.label.length + 2) });
  cols.push({ wch: 10 });
  ws['!cols'] = cols;
  // Freeze the header column + the first four rows (title + KD line + blank + header)
  ws['!freeze'] = { xSplit: 1, ySplit: 4 };
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
  // v1.5 — Urine ketone is no longer an input. For data captured under v1.4
  // or earlier the schema still has urineKetone values, so we keep the Urine
  // column conditionally — visible only when at least one record has a urine
  // reading. New exports under v1.5 will simply not have those columns.
  const anyUrine = measurements.some(m => m.urineKetone != null);

  const headers = anyUrine
    ? ['Date', 'Date (UK)', 'Time', 'Method', 'Ketone (mmol/L)', 'Urine ketone', 'Glucose (mmol/L)', 'GKI', 'In target?', 'Notes']
    : ['Date', 'Date (UK)', 'Time', 'Ketone (mmol/L)', 'Glucose (mmol/L)', 'GKI', 'In target?', 'Notes'];
  const rows = [headers];
  for (const m of measurements) {
    const d = new Date(m.timestamp);
    const gki = (m.bloodKetone && m.glucose && m.bloodKetone > 0) ? round2(m.glucose / m.bloodKetone) : '';
    const inT = (m.bloodKetone != null && settings.ketoneMin != null && settings.ketoneMax != null)
      ? (m.bloodKetone >= settings.ketoneMin && m.bloodKetone <= settings.ketoneMax ? 'Yes' : 'No')
      : '';
    if (anyUrine) {
      const method = m.bloodKetone != null ? 'Blood' : (m.urineKetone != null ? 'Urine' : '');
      rows.push([
        fmtDateISO(m.timestamp),
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
    } else {
      rows.push([
        fmtDateISO(m.timestamp),
        fmtDateUK(m.timestamp),
        fmtTime24(d),
        m.bloodKetone != null ? m.bloodKetone : '',
        m.glucose != null ? m.glucose : '',
        gki,
        inT,
        m.notes || ''
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = anyUrine
    ? [{ wch: 11 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 7 }, { wch: 11 }, { wch: 36 }]
    : [{ wch: 11 }, { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 18 }, { wch: 7 }, { wch: 11 }, { wch: 36 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const lastCol = anyUrine ? 'J' : 'H';
  ws['!autofilter'] = { ref: `A1:${lastCol}${rows.length}` };
  return ws;
}

function buildSeizuresSheet(seizures, measurements, settings) {
  // v1.3: ISO date in column A; UK date kept next to it for readability.
  const headers = [
    'Date', 'Date (UK)', 'Time', 'Type', 'Duration', 'Triggers', 'Rescue medication', 'Recovery (min)',
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
      fmtDateISO(s.startTime),
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
    { wch: 11 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 9 }, { wch: 28 }, { wch: 22 }, { wch: 13 },
    { wch: 17 }, { wch: 11 }, { wch: 18 }, { wch: 11 }, { wch: 36 }
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!autofilter'] = { ref: `A1:M${rows.length}` };
  return ws;
}

/**
 * v1.3 — ReadMe tab. First sheet in the workbook so anyone opening the
 * file cold sees how everything fits together. Replaces the old About
 * tab. Includes the same metadata at the bottom.
 */
function buildReadMeSheet(settings, fromMs, toMs, nMeas, nSeiz) {
  const rows = [
    ['KetoCare export — ReadMe'],
    [''],
    ['This spreadsheet was exported from KetoCare, a tracking tool used by'],
    ['parents of children on the ketogenic diet for epilepsy. It is a'],
    ['personal record-keeping tool, not a medical device.'],
    [''],
    ['Tabs'],
    ['  ReadMe        — this page.'],
    ['  Summary       — overview of the period at a glance.'],
    ['  Monthly       — types as rows, time periods (e.g. months) as columns,'],
    ['                  totals on the right. The view clinicians find easiest'],
    ['                  to read for "what changed across the year".'],
    ['  Daily         — one row per day. Best place to spot day-to-day variation.'],
    ['  Measurements  — every ketone/glucose reading recorded (long format).'],
    ['  Seizures      — every seizure recorded, with the closest ketone'],
    ['                  reading before and after each event.'],
    ['  Daily detail  — long-format interleave of measurements and seizures'],
    ['                  in chronological order, one row each, with a'],
    ['                  record_type column. Useful for pivot tables.'],
    ['  Patterns data — the same views shown on the in-app Patterns screen,'],
    ['                  as plain cells. AM/PM stats, type counts, per-type'],
    ['                  counts and median durations, hour-of-day histogram,'],
    ['                  day-of-week histogram, triggers tally.'],
    [''],
    ['How the tabs link'],
    ['  Every event/measurement/daily row has a "Date" column in ISO'],
    ['  format (YYYY-MM-DD). Use this column to join across tabs — for'],
    ['  example, with VLOOKUP / XLOOKUP, or by dragging into a pivot'],
    ['  table grouped by date. The "Date (UK)" column shows the same'],
    ['  date in DD/MM/YYYY format for skimming.'],
    [''],
    ['Units'],
    ['  Ketone   mmol/L (β-hydroxybutyrate)'],
    ['  Glucose  mmol/L'],
    ['  GKI      Glucose ÷ Ketone (both in mmol/L)'],
    [''],
    ['Notes on the data'],
    ['  • All values are parent-reported. Ketone meters have known'],
    ['    measurement variability; treat extreme single values with'],
    ['    appropriate caution.'],
    ['  • GKI is only calculated when both blood ketone and glucose were'],
    ['    measured at the same time.'],
    ['  • The "Last ketone before" / "First ketone after" columns on the'],
    ['    Seizures tab show the nearest blood ketone reading on either'],
    ['    side of each seizure. The hours-gap column tells you how close'],
    ['    in time that reading was.'],
    ['  • The "In target" columns use the target range set by the family'],
    ['    in the app settings (typically agreed with their dietitian).'],
    ['  • Time-bucketed views (the Monthly and Patterns data tabs) auto-pick'],
    ['    the bucket type from the export range length:'],
    ['      ≤7 days   — daily'],
    ['      8–60 days — calendar weeks (Mon–Sun)'],
    ['      >60 days  — calendar months (e.g. Apr 23, May 23, …)'],
    ['    The first and last buckets may be partial — for example, when'],
    ['    the range starts mid-month, the first column is labelled with'],
    ['    "(from N)" to make that visible.'],
    ['  • Patterns data is descriptive only. No correlations are calculated.'],
    [''],
    ['Export details'],
    ['  Child name      ' + (settings.childName || '—')],
    ['  Started keto    ' + (settings.kdStartDate
                            ? new Date(settings.kdStartDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                            : '—')],
    ['  Diet variant    ' + formatVariant(settings.variant, settings)],
    ['  Period          ' + fmtDateUK(fromMs) + ' to ' + fmtDateUK(toMs)],
    ['  Records         ' + nMeas + ' measurements, ' + nSeiz + ' seizures'],
    ['  Generated       ' + new Date().toLocaleString('en-GB')],
    ['  App version     v1.5']
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 78 }];
  return ws;
}

/**
 * v1.3 — Daily detail tab. One row per record (measurement OR seizure)
 * in chronological order, with a record_type column. Long-format and
 * tidy: a single ISO date column, time, and the union of useful fields
 * from both record types. Empty cells where a column doesn't apply.
 *
 * Designed for pivot tables. To get "everything for one day", filter
 * by Date. To get all seizures of a specific type, filter Type. To
 * see ketones around each seizure, sort by date+time and read in order.
 */
function buildDailyDetailSheet(measurements, seizures, settings) {
  // v1.5 — Urine column shown only when at least one measurement has a
  // urine value (legacy data from v1.4 or earlier). Match the conditional
  // behaviour of buildMeasurementsSheet.
  const anyUrine = measurements.some(m => m.urineKetone != null);

  const headers = anyUrine
    ? ['Date', 'Date (UK)', 'Time', 'Record type',
       'Ketone (mmol/L)', 'Urine ketone', 'Glucose (mmol/L)', 'GKI', 'In target?',
       'Seizure type', 'Duration (sec)', 'Triggers', 'Rescue medication', 'Recovery (min)',
       'Notes']
    : ['Date', 'Date (UK)', 'Time', 'Record type',
       'Ketone (mmol/L)', 'Glucose (mmol/L)', 'GKI', 'In target?',
       'Seizure type', 'Duration (sec)', 'Triggers', 'Rescue medication', 'Recovery (min)',
       'Notes'];
  const rows = [headers];

  // Build a combined event list sorted by timestamp
  const events = [];
  for (const m of measurements) events.push({ ts: m.timestamp, kind: 'measurement', data: m });
  for (const s of seizures) events.push({ ts: s.startTime, kind: 'seizure', data: s });
  events.sort((a, b) => a.ts - b.ts);

  for (const ev of events) {
    const d = new Date(ev.ts);
    if (ev.kind === 'measurement') {
      const m = ev.data;
      const gki = (m.bloodKetone && m.glucose && m.bloodKetone > 0) ? round2(m.glucose / m.bloodKetone) : '';
      const inT = (m.bloodKetone != null && settings.ketoneMin != null && settings.ketoneMax != null)
        ? (m.bloodKetone >= settings.ketoneMin && m.bloodKetone <= settings.ketoneMax ? 'Yes' : 'No')
        : '';
      const measRow = anyUrine
        ? [
            fmtDateISO(ev.ts), fmtDateUK(ev.ts), fmtTime24(d), 'measurement',
            m.bloodKetone != null ? m.bloodKetone : '',
            m.urineKetone != null ? urineLabel(m.urineKetone) : '',
            m.glucose != null ? m.glucose : '', gki, inT,
            '', '', '', '', '',
            m.notes || ''
          ]
        : [
            fmtDateISO(ev.ts), fmtDateUK(ev.ts), fmtTime24(d), 'measurement',
            m.bloodKetone != null ? m.bloodKetone : '',
            m.glucose != null ? m.glucose : '', gki, inT,
            '', '', '', '', '',
            m.notes || ''
          ];
      rows.push(measRow);
    } else {
      const s = ev.data;
      const seizRow = anyUrine
        ? [
            fmtDateISO(ev.ts), fmtDateUK(ev.ts), fmtTime24(d), 'seizure',
            '', '', '', '', '',
            formatSeizureType(s, settings),
            s.durationSec != null ? s.durationSec : '',
            (s.triggers || []).map(t => t.replace('-', ' ')).join('; '),
            s.rescueMed || '',
            s.recoveryMin != null ? s.recoveryMin : '',
            s.notes || ''
          ]
        : [
            fmtDateISO(ev.ts), fmtDateUK(ev.ts), fmtTime24(d), 'seizure',
            '', '', '', '',
            formatSeizureType(s, settings),
            s.durationSec != null ? s.durationSec : '',
            (s.triggers || []).map(t => t.replace('-', ' ')).join('; '),
            s.rescueMed || '',
            s.recoveryMin != null ? s.recoveryMin : '',
            s.notes || ''
          ];
      rows.push(seizRow);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = anyUrine
    ? [
        { wch: 11 }, { wch: 12 }, { wch: 8 }, { wch: 12 },
        { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 7 }, { wch: 11 },
        { wch: 18 }, { wch: 14 }, { wch: 28 }, { wch: 22 }, { wch: 13 },
        { wch: 36 }
      ]
    : [
        { wch: 11 }, { wch: 12 }, { wch: 8 }, { wch: 12 },
        { wch: 16 }, { wch: 18 }, { wch: 7 }, { wch: 11 },
        { wch: 18 }, { wch: 14 }, { wch: 28 }, { wch: 22 }, { wch: 13 },
        { wch: 36 }
      ];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const lastCol = anyUrine ? 'O' : 'N';
  ws['!autofilter'] = { ref: `A1:${lastCol}${rows.length}` };
  return ws;
}

/**
 * v1.3 — Patterns data tab. Mirrors the in-app Patterns screen as plain
 * cells. No images, no charts. Anyone who wants a chart can highlight a
 * range and Insert → Chart in Excel themselves.
 *
 * Bucketing for per-type matrices auto-picks from the export range to
 * match in-app rules:
 *   ≤21d    → weekly
 *   22–120d → monthly
 *   >120d   → quarterly
 *
 * Sections (separated by blank rows):
 *   1. AM/PM stats table (Ketone, Glucose, GKI: min/max/mean/median/n × AM/PM)
 *   2. Seizures-by-type counts
 *   3. Per-type counts by bucket (one row per type, columns = bucket starts)
 *   4. Per-type median duration by bucket (seconds)
 *   5. Seizures by hour of day (0–23)
 *   6. Seizures by day of week (Mon–Sun)
 *   7. Triggers tally
 */
function buildPatternsSheet(settings, measurements, seizures, fromMs, toMs) {
  const MORNING_END = KCCharts.MORNING_END_HOUR;
  const isMorning = (ts) => new Date(ts).getHours() < MORNING_END;
  const rows = [];

  // Header
  rows.push(['Patterns data']);
  rows.push(['Period', fmtDateUK(fromMs) + ' to ' + fmtDateUK(toMs)]);
  rows.push(['Source', 'KetoCare in-app Patterns view, exported as cells']);
  rows.push(['Note',   'Descriptive only — no correlations or predictions calculated.']);
  rows.push([]);

  /* ---------- 1. AM/PM stats ---------- */
  const amM = measurements.filter(m => isMorning(m.timestamp));
  const pmM = measurements.filter(m => !isMorning(m.timestamp));
  const vals = (records, key) => records
    .filter(m => m[key] != null && !isNaN(m[key])).map(m => m[key]);
  const valsGKI = (records) => records
    .filter(m => m.bloodKetone && m.glucose && m.bloodKetone > 0)
    .map(m => m.glucose / m.bloodKetone);

  // Local stats helper that returns numbers (not pre-formatted strings
  // like KCCharts.computeStats does) so the cells stay numeric.
  const stats = (xs) => {
    if (!xs.length) return { min: '', max: '', mean: '', median: '', count: 0 };
    const sorted = xs.slice().sort((a, b) => a - b);
    const sum = xs.reduce((a, b) => a + b, 0);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return {
      min: round2(sorted[0]),
      max: round2(sorted[sorted.length - 1]),
      mean: round2(sum / xs.length),
      median: round2(median),
      count: xs.length
    };
  };

  const metrics = [
    { name: 'Ketone (mmol/L)',  am: stats(vals(amM, 'bloodKetone')), pm: stats(vals(pmM, 'bloodKetone')) },
    { name: 'Glucose (mmol/L)', am: stats(vals(amM, 'glucose')),     pm: stats(vals(pmM, 'glucose')) },
    { name: 'GKI',              am: stats(valsGKI(amM)),             pm: stats(valsGKI(pmM)) }
  ];

  rows.push(['AM/PM split stats']);
  rows.push(['Metric', 'AM min', 'AM max', 'AM mean', 'AM median', 'AM n', 'PM min', 'PM max', 'PM mean', 'PM median', 'PM n']);
  for (const m of metrics) {
    rows.push([
      m.name,
      m.am.min, m.am.max, m.am.mean, m.am.median, m.am.count,
      m.pm.min, m.pm.max, m.pm.mean, m.pm.median, m.pm.count
    ]);
  }
  const amSeiz = seizures.filter(s => isMorning(s.startTime)).length;
  const pmSeiz = seizures.filter(s => !isMorning(s.startTime)).length;
  rows.push(['Seizures (total)', amSeiz, '', '', '', '', pmSeiz, '', '', '', '']);
  rows.push([]);

  /* ---------- 2. Seizures-by-type counts ---------- */
  rows.push(['Seizures by type']);
  rows.push(['Type', 'Count']);
  const typeCounts = KCCharts.seizureTypeCounts(seizures, settings);
  for (const c of typeCounts) rows.push([c.label, c.count]);
  if (typeCounts.length) {
    rows.push(['Total events', typeCounts.reduce((a, c) => a + c.count, 0)]);
  } else {
    rows.push(['(no seizures in period)']);
  }
  rows.push([]);

  /* ---------- 3 + 4. Per-type counts and median durations by bucket ---------- */
  // v1.5 — switch to calendar-anchored buckets matching the in-app Patterns
  // and the new Monthly tab. ≤7d daily / 8–60d weekly / >60d monthly.
  const rangeDays = Math.ceil((toMs - fromMs) / 86400000);
  const { bucket, label: bucketLabelShort } = KCCharts.autoBucketForDays(rangeDays);
  const bucketLabel = bucket === 'day' ? 'Daily buckets'
    : bucket === 'calendar-week' ? 'Calendar weeks (Mon–Sun; first/last may be partial)'
    : 'Calendar months (Jan, Feb, …; first/last may be partial)';

  const typesTable = KCCharts.seizureTypesByPeriodTable(seizures, settings, fromMs, toMs, bucket);

  rows.push(['Per-type frequency over time']);
  rows.push([bucketLabel]);
  if (!typesTable.types.length) {
    rows.push(['(no seizures in period)']);
  } else {
    const bucketLabels = typesTable.buckets.map(b => b.label);
    rows.push(['Type', ...bucketLabels, 'Total']);
    for (const t of typesTable.types) {
      rows.push([t.label, ...t.cells.map(c => c.count), t.totalCount]);
    }
  }
  rows.push([]);

  rows.push(['Per-type median duration (seconds) over time']);
  rows.push(['Buckets where n<3, median is left blank (too few events for a meaningful average; see Seizures tab for individual durations).']);
  if (!typesTable.types.length) {
    rows.push(['(no timed seizures in period)']);
  } else {
    const bucketLabels = typesTable.buckets.map(b => b.label);
    rows.push(['Type', ...bucketLabels, 'Total timed events']);
    for (const t of typesTable.types) {
      const cells = t.cells.map(c => (c.count >= 3 && c.median != null) ? Math.round(c.median) : '');
      rows.push([t.label, ...cells, t.totalDurations.length]);
    }
  }
  rows.push([]);

  /* ---------- 5. Hour of day ---------- */
  rows.push(['Seizures by hour of day']);
  rows.push(['Hour', 'Count']);
  const hourSeries = KCCharts.seizuresByHour(seizures);
  for (let h = 0; h < 24; h++) {
    rows.push([h, hourSeries.data[h] || 0]);
  }
  rows.push([]);

  /* ---------- 6. Day of week ---------- */
  rows.push(['Seizures by day of week']);
  rows.push(['Day', 'Count']);
  const dayCounts = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
  for (const s of seizures) {
    // JS Date.getDay(): 0=Sun..6=Sat. Re-map to 0=Mon..6=Sun.
    const dow = (new Date(s.startTime).getDay() + 6) % 7;
    dayCounts[dow]++;
  }
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 0; i < 7; i++) rows.push([dayNames[i], dayCounts[i]]);
  rows.push([]);

  /* ---------- 7. Triggers ---------- */
  rows.push(['Triggers tally']);
  rows.push(['Trigger', 'Count']);
  const triggerData = KCCharts.triggerCounts(seizures);
  if (triggerData.items.length) {
    for (const t of triggerData.items) rows.push([t.label, t.count]);
  } else {
    rows.push(['(no triggers logged)']);
  }
  rows.push([]);
  rows.push(['Total seizures with at least one trigger logged',
             triggerData.seizuresWithTrigger, 'of', triggerData.totalSeizures]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Generous first column for section headings and type labels; rest fit
  // small numeric values. The columns we use vary by section but a single
  // sensible default is fine.
  ws['!cols'] = [
    { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }
  ];
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
  doc.text('Started keto', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(
    settings.kdStartDate
      ? new Date(settings.kdStartDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—',
    MARGIN + 30, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Diet variant', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(formatVariant(settings.variant, settings), MARGIN + 30, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Period', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  // v1.5 — Annotate "since KD started" when the From date aligns with the
  // KD start date (within a day). This is the common case for clinic prep.
  let periodLine = `${fmtDateISO(fromMs)} to ${fmtDateISO(toMs)}`;
  if (settings.kdStartDate) {
    const kdStartMs = new Date(settings.kdStartDate + 'T00:00:00').getTime();
    if (!isNaN(kdStartMs) && Math.abs(fromMs - kdStartMs) < 86400000) {
      periodLine += '  (since KD started)';
    }
  }
  doc.text(periodLine, MARGIN + 30, y);
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
  // v1.5 — Charts use the same auto-bucketing as the in-app Trends screen so
  // long ranges (e.g. "Since KD started" over a full year) become 12 monthly
  // points instead of 365 daily points. Bucket choice is computed once and
  // reused for the Patterns charts further down.
  const pdfMainRangeDays = Math.ceil((toMs - fromMs) / 86400000);
  const { bucket: pdfMainBucket, label: pdfMainBucketLabel } = KCCharts.autoBucketForDays(pdfMainRangeDays);
  const ketoneSeries  = KCCharts.bucketedSeries(measurements, 'bloodKetone', fromMs, toMs, pdfMainBucket);
  const glucoseSeries = KCCharts.bucketedSeries(measurements, 'glucose', fromMs, toMs, pdfMainBucket);
  const gkiSeries     = KCCharts.bucketedSeries(
    measurements,
    (r) => (r.bloodKetone && r.glucose && r.bloodKetone > 0 ? r.glucose / r.bloodKetone : null),
    fromMs, toMs, pdfMainBucket
  );
  const seizureSeries = KCCharts.bucketedCounts(seizures, fromMs, toMs, pdfMainBucket);
  const hourSeries = KCCharts.seizuresByHour(seizures);

  y = await renderOffscreenCombinedLineChartToPDF(doc, `Ketone trend (mmol/L) · ${pdfMainBucketLabel}`, y, MARGIN, PAGE_W,
    ketoneSeries, KCCharts.COLORS.sageDeep,
    (settings.ketoneMin && settings.ketoneMax) ? { min: settings.ketoneMin, max: settings.ketoneMax } : null,
    null);
  y = await renderOffscreenCombinedLineChartToPDF(doc, `Glucose trend (mmol/L) · ${pdfMainBucketLabel}`, y, MARGIN, PAGE_W,
    glucoseSeries, KCCharts.COLORS.honey, null, null);
  y = await renderOffscreenCombinedLineChartToPDF(doc, `GKI trend · ${pdfMainBucketLabel}`, y, MARGIN, PAGE_W,
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

  // AM/PM ketone chart with seizure markers — uses v1.5 bucketing so the
  // x-axis matches the type tables below (monthly for >60d, weekly otherwise).
  const rangeDays = Math.ceil((toMs - fromMs) / 86400000);
  const { bucket: pdfBucket, label: pdfBucketLabel } = KCCharts.autoBucketForDays(rangeDays);
  const ketoneSplit = KCCharts.bucketedMorningEveningSeries(measurements, 'bloodKetone', fromMs, toMs, pdfBucket);
  const bucketedMarkers = KCCharts.seizureBucketMarkers(seizures, fromMs, toMs, pdfBucket);
  y = await renderOffscreenSplitLineChartToPDF(doc, `Ketone trend — AM vs PM (mmol/L) · ${pdfBucketLabel}`, y, MARGIN, PAGE_W,
    ketoneSplit, KCCharts.COLORS.sage, KCCharts.COLORS.sageDeep,
    (settings.ketoneMin && settings.ketoneMax) ? { min: settings.ketoneMin, max: settings.ketoneMax } : null,
    bucketedMarkers);

  // v1.5 — Seizure types over time as TABLES (replaces v1.3 small-multiples).
  // Type rows × bucket columns + Total column. Uses the same auto-bucketing
  // as the rest of the screen so PDF readers see the same data shape they
  // saw in the app.
  if (rangeDays >= 14) {
    const tableData = KCCharts.seizureTypesByPeriodTable(seizures, settings, fromMs, toMs, pdfBucket);
    if (tableData.types.length) {
      y = renderSeizureTypesFrequencyTableToPDF(doc, `Seizure types — frequency · ${pdfBucketLabel}`, y, MARGIN, PAGE_W, tableData);
      y = renderSeizureTypesDurationTableToPDF(doc, `Seizure types — median duration · ${pdfBucketLabel} (mm:ss; * = fewer than 3 events)`, y, MARGIN, PAGE_W, tableData);
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
 * v1.5 — Seizure types frequency table for PDF. Type rows × bucket columns
 * + Total column, matching the in-app view and the parent's-spreadsheet
 * layout. Drawn directly with jsPDF (no Chart.js) — tables are easier in
 * raw jsPDF than an off-screen canvas, and they read more honestly at
 * small numbers.
 *
 * `tableData` is the output of KCCharts.seizureTypesByPeriodTable.
 *
 * Page-break handling: if the table won't fit on the current page, we
 * start a fresh page. If the column count is so large that the table is
 * wider than the page, the columns auto-shrink in font size; if even at
 * 6pt they don't fit, we fall back to splitting the columns across
 * multiple stacked tables (rare — only happens for 2y+ exports).
 */
function renderSeizureTypesFrequencyTableToPDF(doc, title, y, margin, pageW, tableData) {
  if (!tableData || !tableData.types.length) return y;
  const totalsRow = {
    label: 'All types',
    cells: tableData.buckets.map((_, i) =>
      tableData.types.reduce((a, t) => a + (t.cells[i] ? t.cells[i].count : 0), 0)
    ),
    total: tableData.types.reduce((a, t) => a + t.totalCount, 0),
    isTotals: true
  };
  const rows = tableData.types.map(t => ({
    label: t.label,
    cells: t.cells.map(c => (c.count === 0 ? '—' : String(c.count))),
    total: String(t.totalCount),
    bold: false
  }));
  rows.push({
    label: totalsRow.label,
    cells: totalsRow.cells.map(v => (v === 0 ? '—' : String(v))),
    total: String(totalsRow.total),
    bold: true,
    isTotals: true
  });
  return _renderTypesTableToPDF(doc, title, y, margin, pageW, tableData.buckets, rows);
}

/**
 * v1.5 — Seizure types duration table for PDF. Same column shape as the
 * frequency table; cell values are median seconds formatted as mm:ss. A
 * trailing "*" marker means "fewer than 3 events — too few for a median",
 * matching the in-app dot-mode convention.
 */
function renderSeizureTypesDurationTableToPDF(doc, title, y, margin, pageW, tableData) {
  if (!tableData || !tableData.types.length) return y;
  const fmt = KCCharts.fmtDurationMmSs;
  const rows = tableData.types.map(t => {
    const cells = t.cells.map(c => {
      if (c.count === 0) return '—';
      if (c.count < 3) {
        const first = c.durations.length ? fmt(c.durations[0]) : '—';
        return `${first}*`;
      }
      return fmt(c.median);
    });
    // "Total" cell for duration row = overall median across the range
    let totalStr;
    if (!t.totalDurations.length) {
      totalStr = '—';
    } else if (t.totalDurations.length < 3) {
      totalStr = `${fmt(t.totalDurations[0])}*`;
    } else {
      const sorted = t.totalDurations.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
      totalStr = fmt(med);
    }
    return { label: t.label, cells, total: totalStr, bold: false };
  });
  return _renderTypesTableToPDF(doc, title, y, margin, pageW, tableData.buckets, rows);
}

/**
 * Shared low-level table renderer used by both frequency and duration tables.
 * Auto-shrinks font size and column widths to fit the page width. Partial
 * buckets (e.g. the first month if KD started mid-month) get a subtle
 * terracotta-tinted background to flag the partial nature.
 */
function _renderTypesTableToPDF(doc, title, y, margin, pageW, buckets, rows) {
  const usableW = pageW - margin * 2;

  // Page-break check — if the title + a header + one row won't fit, new page.
  const minNeeded = 6 + 6 + 5;
  if (y + minNeeded > 280) { doc.addPage(); y = margin; }

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(45, 42, 38);
  const titleLines = doc.splitTextToSize(title, usableW);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 5 + 1;

  // Column widths — type-name column is fixed-ish, the rest share the remainder
  // including a Total column at the end. Total column gets slightly extra.
  const nCols = buckets.length + 2; // label + buckets + total
  // Type-label column: wider for the in-app table, but in print we need to
  // trim aggressively if there are many buckets. Cap at 32mm, floor at 18mm.
  let labelW = Math.max(18, Math.min(32, usableW * 0.20));
  let totalW = 12;
  let remW = usableW - labelW - totalW;
  let cellW = remW / buckets.length;

  // If cells are too narrow, shrink the label column some more.
  let fontSize = 9;
  if (cellW < 10) {
    labelW = 18;
    totalW = 11;
    cellW = (usableW - labelW - totalW) / buckets.length;
    fontSize = 8;
  }
  if (cellW < 8) {
    fontSize = 7;
  }
  if (cellW < 6.5) {
    fontSize = 6;
  }
  // If still too narrow, leave it — the text will overflow visibly which is
  // honest signal that the export should have a shorter range. Real users
  // would typically pick a custom range or a single year.

  doc.setFontSize(fontSize);
  const rowH = fontSize === 6 ? 3.6 : (fontSize === 7 ? 4 : (fontSize === 8 ? 4.4 : 5));
  const headH = rowH;

  // Header row
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(90, 84, 76);
  doc.setFillColor(247, 240, 226); // surface
  doc.rect(margin, y, usableW, headH, 'F');
  doc.text('Type', margin + 1, y + headH - 1);
  for (let i = 0; i < buckets.length; i++) {
    const cx = margin + labelW + i * cellW + cellW / 2;
    const label = buckets[i].label;
    doc.text(label, cx, y + headH - 1, { align: 'center' });
  }
  doc.text('Total', margin + labelW + buckets.length * cellW + totalW / 2, y + headH - 1, { align: 'center' });
  // Underline header
  doc.setDrawColor(168, 90, 72); // terra-deep
  doc.setLineWidth(0.3);
  doc.line(margin, y + headH + 0.2, margin + usableW, y + headH + 0.2);
  y += headH + 0.6;

  // Body rows
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(45, 42, 38);
  for (const row of rows) {
    // Page break per-row if needed
    if (y + rowH > 280) {
      doc.addPage();
      y = margin;
      // Redraw a tiny header marker so the continuation is readable
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(fontSize);
      doc.setTextColor(138, 130, 120);
      doc.text(`${title} (continued)`, margin, y);
      y += rowH;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(45, 42, 38);
    }

    // Subtle stripe for the totals row
    if (row.isTotals) {
      doc.setFillColor(226, 234, 217); // sage-tint
      doc.rect(margin, y - 0.4, usableW, rowH, 'F');
    }

    // Partial-bucket background highlight
    buckets.forEach((b, i) => {
      if (b.isPartial) {
        doc.setFillColor(252, 246, 240);
        doc.rect(margin + labelW + i * cellW, y - 0.4, cellW, rowH, 'F');
      }
    });

    // Label — truncate with ellipsis if too long
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    let label = row.label;
    const maxW = labelW - 2;
    while (doc.getTextWidth(label) > maxW && label.length > 4) {
      label = label.slice(0, -1);
    }
    if (label !== row.label) label = label.slice(0, -1) + '…';
    doc.text(label, margin + 1, y + rowH - 1);

    // Cells
    doc.setFont('helvetica', 'normal');
    for (let i = 0; i < buckets.length; i++) {
      const cx = margin + labelW + i * cellW + cellW / 2;
      doc.text(row.cells[i], cx, y + rowH - 1, { align: 'center' });
    }
    // Total
    doc.setFont('helvetica', 'bold');
    doc.text(row.total, margin + labelW + buckets.length * cellW + totalW / 2, y + rowH - 1, { align: 'center' });
    doc.setFont('helvetica', 'normal');

    y += rowH;
  }

  // Footer line
  doc.setDrawColor(227, 216, 197);
  doc.setLineWidth(0.2);
  doc.line(margin, y + 0.5, margin + usableW, y + 0.5);

  // Reset
  doc.setFontSize(10);
  doc.setTextColor(45, 42, 38);
  return y + 5;
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
