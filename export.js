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

  const rows = [];
  rows.push(['# KetoCare export']);
  rows.push(['# Child', settings.childName || '']);
  rows.push(['# Diet variant', settings.variant || '']);
  rows.push(['# Range', fmtDateISO(fromMs), 'to', fmtDateISO(toMs)]);
  rows.push([]);

  // Combined event table
  rows.push(['Date', 'Time', 'Event', 'Blood ketone (mmol/L)', 'Urine ketone', 'Glucose (mmol/L)', 'GKI', 'Seizure type', 'Duration (sec)', 'Triggers', 'Rescue medication', 'Recovery (min)', 'Notes']);

  const events = [];
  measurements.forEach(m => events.push({ ts: m.timestamp, kind: 'measurement', data: m }));
  seizures.forEach(s => events.push({ ts: s.startTime, kind: 'seizure', data: s }));
  events.sort((a, b) => a.ts - b.ts);

  for (const ev of events) {
    if (ev.kind === 'measurement') {
      const m = ev.data;
      const gki = (m.bloodKetone && m.glucose) ? (m.glucose / m.bloodKetone).toFixed(2) : '';
      rows.push([
        fmtDateISO(m.timestamp),
        fmtTimeISO(m.timestamp),
        'Measurement',
        m.bloodKetone || '',
        m.urineKetone != null ? m.urineKetone : '',
        m.glucose || '',
        gki,
        '', '', '', '', '',
        m.notes || ''
      ]);
    } else {
      const s = ev.data;
      rows.push([
        fmtDateISO(s.startTime),
        fmtTimeISO(s.startTime),
        'Seizure',
        '', '', '', '',
        s.type || '',
        s.durationSec || '',
        (s.triggers || []).join('; '),
        s.rescueMed || '',
        s.recoveryMin != null ? s.recoveryMin : '',
        s.notes || ''
      ]);
    }
  }

  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const filename = `ketocare_${(settings.childName || 'export').replace(/\s+/g,'_')}_${fmtDateISO(fromMs)}_to_${fmtDateISO(toMs)}.csv`;
  downloadBlob(blob, filename);
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
