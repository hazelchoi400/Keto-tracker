/* =====================================================
   app.js — main application logic
   ===================================================== */

const state = {
  screen: 'home',
  settings: null,
  // Seizure timer
  timerInterval: null,
  timerStartedAt: null,
  timerElapsedSec: 0,
  // Forms
  pendingSeizure: null,
  editingSeizureId: null,
  editingMeasurementId: null,
  selectedSeizureType: null,
  selectedSeizureTriggers: [],
  selectedKetoneMethod: 'blood',
  selectedUrineKetone: null,
  selectedHistoryFilter: 'all',
  selectedTrendRange: 30,
  selectedSettingVariant: 'classical-4-1',
  selectedSettingDefaultKetone: 'blood'
};

/* =====================================================
   Toast
   ===================================================== */

function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

/* =====================================================
   Navigation
   ===================================================== */

function navigateTo(screenName) {
  state.screen = screenName;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.querySelector(`.screen[data-screen="${screenName}"]`);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);

  // Refresh per-screen
  if (screenName === 'home')         renderHome();
  if (screenName === 'history')      renderHistory();
  if (screenName === 'trends')       renderTrends();
  if (screenName === 'export')       initExportScreen();
  if (screenName === 'settings')     populateSettingsForm();
  if (screenName === 'seizure-timer') resetTimer();
  if (screenName === 'measurement')   resetMeasurementForm();
}

/* =====================================================
   Chip group helpers
   ===================================================== */

function setupChipGroup(field, isMulti, onChange) {
  document.querySelectorAll(`.chip-group[data-field="${field}"]`).forEach(group => {
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const value = chip.dataset.value;
      if (isMulti) {
        chip.classList.toggle('selected');
        const selected = [...group.querySelectorAll('.chip.selected')].map(c => c.dataset.value);
        if (onChange) onChange(selected);
      } else {
        group.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        if (onChange) onChange(value);
      }
    });
  });
}

function selectChipValue(field, value) {
  document.querySelectorAll(`.chip-group[data-field="${field}"]`).forEach(group => {
    group.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('selected', String(c.dataset.value) === String(value));
    });
  });
}

function selectChipValues(field, values) {
  document.querySelectorAll(`.chip-group[data-field="${field}"]`).forEach(group => {
    group.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('selected', values.includes(c.dataset.value));
    });
  });
}

/* =====================================================
   HOME
   ===================================================== */

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Late evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

async function renderHome() {
  // Always re-read settings so home reflects newly saved values
  const settings = await KCDB.getSettings();
  state.settings = settings;
  document.getElementById('greetingEyebrow').textContent = getGreeting();
  document.getElementById('greetingName').textContent =
    settings.childName ? `Caring for ${settings.childName}` : 'Welcome';

  const measurements = await KCDB.getAllMeasurements();
  const seizures = await KCDB.getAllSeizures();

  measurements.sort((a,b) => b.timestamp - a.timestamp);
  const lastWithBlood = measurements.find(m => m.bloodKetone);
  const lastWithUrine = measurements.find(m => m.urineKetone != null);
  const lastGluc = measurements.find(m => m.glucose);

  const el = (id) => document.getElementById(id);
  const ketoneEl = el('todayKetone');
  if (lastWithBlood) {
    ketoneEl.textContent = lastWithBlood.bloodKetone.toFixed(1);
    ketoneEl.parentElement.classList.toggle('in-range',
      settings.ketoneMin && settings.ketoneMax &&
      lastWithBlood.bloodKetone >= settings.ketoneMin &&
      lastWithBlood.bloodKetone <= settings.ketoneMax);
    ketoneEl.parentElement.classList.toggle('out-range',
      settings.ketoneMin && settings.ketoneMax &&
      (lastWithBlood.bloodKetone < settings.ketoneMin || lastWithBlood.bloodKetone > settings.ketoneMax));
  } else if (lastWithUrine) {
    ketoneEl.textContent = KCExport.urineLabel(lastWithUrine.urineKetone);
  } else {
    ketoneEl.textContent = '—';
  }

  el('todayGlucose').textContent = lastGluc ? lastGluc.glucose.toFixed(1) : '—';

  // GKI from latest pair within ±30 min
  let gki = '—';
  for (const m of measurements) {
    if (m.bloodKetone && m.glucose) {
      gki = (m.glucose / m.bloodKetone).toFixed(1);
      break;
    }
  }
  el('todayGKI').textContent = gki;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayCount = seizures.filter(s => s.startTime >= todayStart.getTime()).length;
  el('todaySeizures').textContent = todayCount;
}

/* =====================================================
   SEIZURE TIMER
   ===================================================== */

function resetTimer() {
  stopTimerInterval();
  state.timerElapsedSec = 0;
  state.timerStartedAt = null;
  document.getElementById('timerDisplay').textContent = '00:00';
  document.getElementById('timerDisplay').classList.remove('running');
  document.getElementById('timerHint').textContent = 'Tap start when the seizure begins';
  document.getElementById('timerStartBtn').classList.remove('hidden');
  document.getElementById('timerStopBtn').classList.add('hidden');
  document.getElementById('timerPulse').classList.remove('active');
}

function startTimer() {
  state.timerStartedAt = Date.now();
  state.timerElapsedSec = 0;
  document.getElementById('timerStartBtn').classList.add('hidden');
  document.getElementById('timerStopBtn').classList.remove('hidden');
  document.getElementById('timerPulse').classList.add('active');
  document.getElementById('timerDisplay').classList.add('running');
  document.getElementById('timerHint').textContent = 'Tap stop when the seizure ends';
  state.timerInterval = setInterval(updateTimerDisplay, 250);
}

function stopTimerInterval() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

function updateTimerDisplay() {
  const elapsed = Math.floor((Date.now() - state.timerStartedAt) / 1000);
  state.timerElapsedSec = elapsed;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  document.getElementById('timerDisplay').textContent =
    `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function stopTimer() {
  stopTimerInterval();
  const startedAt = state.timerStartedAt;
  const elapsed = state.timerElapsedSec;
  state.pendingSeizure = {
    startTime: startedAt,
    durationSec: elapsed
  };
  state.editingSeizureId = null;
  navigateTo('seizure-details');
  populateSeizureForm(state.pendingSeizure);
}

function manualSeizureEntry() {
  state.pendingSeizure = { startTime: Date.now(), durationSec: 0 };
  state.editingSeizureId = null;
  navigateTo('seizure-details');
  populateSeizureForm(state.pendingSeizure);
}

/* =====================================================
   SEIZURE FORM
   ===================================================== */

function toLocalInput(ms) {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fromLocalInput(str) {
  return new Date(str).getTime();
}

function populateSeizureForm(seizure) {
  document.getElementById('seizureStartInput').value = toLocalInput(seizure.startTime || Date.now());

  const min = Math.floor((seizure.durationSec || 0) / 60);
  const sec = (seizure.durationSec || 0) % 60;
  document.getElementById('seizureMinutes').value = min || '';
  document.getElementById('seizureSeconds').value = sec || '';
  document.getElementById('seizureDurationDisplay').textContent =
    seizure.durationSec ? `${min}m ${sec}s` : '0s';

  // Reset chip selections
  document.querySelectorAll('.chip-group[data-field="seizureType"] .chip').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.chip-group[data-field="seizureTriggers"] .chip').forEach(c => c.classList.remove('selected'));
  state.selectedSeizureType = seizure.type || null;
  state.selectedSeizureTriggers = seizure.triggers || [];
  if (seizure.type) selectChipValue('seizureType', seizure.type);
  if (seizure.triggers) selectChipValues('seizureTriggers', seizure.triggers);

  document.getElementById('seizureRescue').value  = seizure.rescueMed || '';
  document.getElementById('seizureRecovery').value = seizure.recoveryMin != null ? seizure.recoveryMin : '';
  document.getElementById('seizureNotes').value    = seizure.notes || '';
}

async function handleSeizureSubmit(e) {
  e.preventDefault();
  const startInput = document.getElementById('seizureStartInput').value;
  const startTime  = startInput ? fromLocalInput(startInput) : Date.now();

  const min = parseInt(document.getElementById('seizureMinutes').value, 10) || 0;
  const sec = parseInt(document.getElementById('seizureSeconds').value, 10) || 0;
  let durationSec = min * 60 + sec;
  if (!durationSec && state.pendingSeizure?.durationSec) durationSec = state.pendingSeizure.durationSec;

  const record = {
    startTime,
    durationSec: durationSec || 0,
    type: state.selectedSeizureType,
    triggers: state.selectedSeizureTriggers,
    rescueMed: document.getElementById('seizureRescue').value.trim(),
    recoveryMin: document.getElementById('seizureRecovery').value
      ? parseInt(document.getElementById('seizureRecovery').value, 10) : null,
    notes: document.getElementById('seizureNotes').value.trim(),
    createdAt: Date.now()
  };

  if (state.editingSeizureId) {
    record.id = state.editingSeizureId;
    await KCDB.updateSeizure(record);
    toast('Seizure updated');
  } else {
    await KCDB.addSeizure(record);
    toast('Seizure logged');
  }

  state.pendingSeizure = null;
  state.editingSeizureId = null;
  navigateTo('home');
}

/* =====================================================
   MEASUREMENT FORM
   ===================================================== */

function resetMeasurementForm() {
  document.getElementById('measureTime').value = toLocalInput(Date.now());
  document.getElementById('bloodKetone').value = '';
  document.getElementById('glucose').value = '';
  document.getElementById('measureNotes').value = '';
  document.getElementById('gkiValue').textContent = '—';
  document.getElementById('gkiHint').textContent = 'Enter blood ketone & glucose to calculate';
  document.getElementById('gkiPreview').classList.remove('in-range', 'out-range');

  const method = state.settings?.defaultKetone || 'blood';
  state.selectedKetoneMethod = method;
  selectChipValue('ketoneMethod', method);
  toggleKetoneFields(method);

  state.selectedUrineKetone = null;
  document.querySelectorAll('.chip-group[data-field="urineKetone"] .chip').forEach(c => c.classList.remove('selected'));

  state.editingMeasurementId = null;
}

function toggleKetoneFields(method) {
  document.getElementById('bloodKetoneField').classList.toggle('hidden', method !== 'blood');
  document.getElementById('urineKetoneField').classList.toggle('hidden', method !== 'urine');
}

function updateGKIPreview() {
  const k = parseFloat(document.getElementById('bloodKetone').value);
  const g = parseFloat(document.getElementById('glucose').value);
  const preview = document.getElementById('gkiPreview');
  const valEl = document.getElementById('gkiValue');
  const hintEl = document.getElementById('gkiHint');

  preview.classList.remove('in-range', 'out-range');

  if (k > 0 && g > 0) {
    const gki = g / k;
    valEl.textContent = gki.toFixed(2);
    const settings = state.settings || {};
    if (settings.gkiMin != null && settings.gkiMax != null) {
      if (gki >= settings.gkiMin && gki <= settings.gkiMax) {
        preview.classList.add('in-range');
        hintEl.textContent = `Within target (${settings.gkiMin}–${settings.gkiMax})`;
      } else {
        preview.classList.add('out-range');
        hintEl.textContent = `Outside target (${settings.gkiMin}–${settings.gkiMax})`;
      }
    } else {
      hintEl.textContent = 'Glucose-Ketone Index';
    }
  } else {
    valEl.textContent = '—';
    hintEl.textContent = 'Enter blood ketone & glucose to calculate';
  }
}

async function handleMeasurementSubmit(e) {
  e.preventDefault();
  const timeStr = document.getElementById('measureTime').value;
  const timestamp = timeStr ? fromLocalInput(timeStr) : Date.now();

  const record = {
    timestamp,
    bloodKetone: null,
    urineKetone: null,
    glucose: null,
    notes: document.getElementById('measureNotes').value.trim(),
    createdAt: Date.now()
  };

  if (state.selectedKetoneMethod === 'blood') {
    const k = parseFloat(document.getElementById('bloodKetone').value);
    if (!isNaN(k)) record.bloodKetone = k;
  } else {
    if (state.selectedUrineKetone != null) record.urineKetone = parseFloat(state.selectedUrineKetone);
  }

  const g = parseFloat(document.getElementById('glucose').value);
  if (!isNaN(g)) record.glucose = g;

  if (record.bloodKetone == null && record.urineKetone == null && record.glucose == null) {
    toast('Please enter at least one value');
    return;
  }

  if (state.editingMeasurementId) {
    record.id = state.editingMeasurementId;
    await KCDB.updateMeasurement(record);
    toast('Measurement updated');
  } else {
    await KCDB.addMeasurement(record);
    toast('Measurement saved');
  }

  navigateTo('home');
}

/* =====================================================
   HISTORY
   ===================================================== */

async function renderHistory() {
  const measurements = await KCDB.getAllMeasurements();
  const seizures = await KCDB.getAllSeizures();
  const events = [];

  if (state.selectedHistoryFilter === 'all' || state.selectedHistoryFilter === 'measurement') {
    measurements.forEach(m => events.push({ ts: m.timestamp, kind: 'measurement', data: m }));
  }
  if (state.selectedHistoryFilter === 'all' || state.selectedHistoryFilter === 'seizure') {
    seizures.forEach(s => events.push({ ts: s.startTime, kind: 'seizure', data: s }));
  }
  events.sort((a,b) => b.ts - a.ts);

  const list = document.getElementById('historyList');
  if (!events.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No entries yet</h3>
        <p>Logs will appear here as you record them.</p>
      </div>
    `;
    return;
  }

  let html = '<p class="history-hint muted small">Tap an entry to edit it</p>';
  let lastDay = null;
  for (const ev of events) {
    const day = new Date(ev.ts);
    day.setHours(0,0,0,0);
    const dayKey = day.getTime();
    if (dayKey !== lastDay) {
      html += `<p class="history-day">${formatDayHeading(day)}</p>`;
      lastDay = dayKey;
    }
    html += renderHistoryItem(ev);
  }
  list.innerHTML = html;
}

function formatDayHeading(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const yest  = new Date(today.getTime() - 86400000);
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yest.getTime())  return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderHistoryItem(ev) {
  const time = new Date(ev.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (ev.kind === 'measurement') {
    const m = ev.data;
    const parts = [];
    if (m.bloodKetone)         parts.push(`Ketone ${m.bloodKetone} mmol/L`);
    if (m.urineKetone != null) parts.push(`Urine ${KCExport.urineLabel(m.urineKetone)}`);
    if (m.glucose)             parts.push(`Glucose ${m.glucose}`);
    if (m.bloodKetone && m.glucose) parts.push(`GKI ${(m.glucose/m.bloodKetone).toFixed(2)}`);
    return `
      <div class="history-item" data-kind="measurement" data-id="${m.id}">
        <div class="history-icon measure">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg>
        </div>
        <div class="history-body">
          <p class="history-title">${parts.join(' · ') || 'Measurement'}</p>
          <p class="history-meta">${time}${m.notes ? ' · ' + m.notes : ''}</p>
        </div>
        <button class="history-delete" aria-label="Delete entry">×</button>
      </div>
    `;
  } else {
    const s = ev.data;
    const min = Math.floor((s.durationSec || 0) / 60);
    const sec = (s.durationSec || 0) % 60;
    const dur = `${min}m ${sec}s`;
    return `
      <div class="history-item" data-kind="seizure" data-id="${s.id}">
        <div class="history-icon seizure">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L4.09 12.97a1 1 0 0 0 .77 1.63H11l-1 7.4a.5.5 0 0 0 .9.34L20 11.4a1 1 0 0 0-.77-1.63H13.5L14.5 2.6a.5.5 0 0 0-.9-.34z" stroke-linejoin="round"/></svg>
        </div>
        <div class="history-body">
          <p class="history-title">${(s.type || 'Seizure').charAt(0).toUpperCase() + (s.type || 'seizure').slice(1)} · ${dur}</p>
          <p class="history-meta">${time}${s.rescueMed ? ' · rescue: ' + s.rescueMed : ''}</p>
        </div>
        <button class="history-delete" aria-label="Delete entry">×</button>
      </div>
    `;
  }
}

async function handleHistoryItemClick(e) {
  // Handle delete button click
  if (e.target.closest('.history-delete')) {
    e.stopPropagation();
    const item = e.target.closest('.history-item');
    if (!item) return;
    const kind = item.dataset.kind;
    const id = parseInt(item.dataset.id, 10);
    if (!confirm('Delete this entry?')) return;
    if (kind === 'measurement') await KCDB.deleteMeasurement(id);
    else await KCDB.deleteSeizure(id);
    toast('Entry deleted');
    renderHistory();
    return;
  }

  const item = e.target.closest('.history-item');
  if (!item) return;
  const kind = item.dataset.kind;
  const id = parseInt(item.dataset.id, 10);

  // Tap on item = edit
  if (kind === 'measurement') {
    const all = await KCDB.getAllMeasurements();
    const rec = all.find(m => m.id === id);
    if (!rec) return;
    navigateTo('measurement');
    state.editingMeasurementId = id;
    document.getElementById('measureTime').value = toLocalInput(rec.timestamp);
    if (rec.bloodKetone) {
      state.selectedKetoneMethod = 'blood';
      selectChipValue('ketoneMethod', 'blood');
      toggleKetoneFields('blood');
      document.getElementById('bloodKetone').value = rec.bloodKetone;
    } else if (rec.urineKetone != null) {
      state.selectedKetoneMethod = 'urine';
      selectChipValue('ketoneMethod', 'urine');
      toggleKetoneFields('urine');
      state.selectedUrineKetone = rec.urineKetone;
      selectChipValue('urineKetone', rec.urineKetone);
    }
    if (rec.glucose) document.getElementById('glucose').value = rec.glucose;
    document.getElementById('measureNotes').value = rec.notes || '';
    updateGKIPreview();
  } else {
    const all = await KCDB.getAllSeizures();
    const rec = all.find(s => s.id === id);
    if (!rec) return;
    state.editingSeizureId = id;
    state.pendingSeizure = rec;
    navigateTo('seizure-details');
    populateSeizureForm(rec);
  }
}

/* =====================================================
   TRENDS
   ===================================================== */

async function renderTrends() {
  const days = state.selectedTrendRange;
  const toMs = Date.now();
  const fromMs = toMs - days * 86400000;

  const measurements = await KCDB.getMeasurementsBetween(fromMs, toMs);
  const seizures     = await KCDB.getSeizuresBetween(fromMs, toMs);

  const ketoneVals = measurements.filter(m => m.bloodKetone).map(m => m.bloodKetone);
  const glucoseVals = measurements.filter(m => m.glucose).map(m => m.glucose);
  const gkiVals = measurements
    .filter(m => m.bloodKetone && m.glucose && m.bloodKetone > 0)
    .map(m => m.glucose / m.bloodKetone);

  // Stat cards
  const stats = {
    ketone:  KCCharts.computeStats(ketoneVals),
    glucose: KCCharts.computeStats(glucoseVals),
    gki:     KCCharts.computeStats(gkiVals)
  };

  const totalSeizures = seizures.length;
  const totalDur = seizures.reduce((a,b) => a + (b.durationSec || 0), 0);

  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card">
      <p class="stat-name">Ketone (mmol/L)</p>
      <p class="stat-row"><span>min</span><span>${stats.ketone.min}</span></p>
      <p class="stat-row"><span>max</span><span>${stats.ketone.max}</span></p>
      <p class="stat-row"><span>mean</span><span>${stats.ketone.mean}</span></p>
      <p class="stat-row"><span>n</span><span>${stats.ketone.count}</span></p>
    </div>
    <div class="stat-card">
      <p class="stat-name">Glucose (mmol/L)</p>
      <p class="stat-row"><span>min</span><span>${stats.glucose.min}</span></p>
      <p class="stat-row"><span>max</span><span>${stats.glucose.max}</span></p>
      <p class="stat-row"><span>mean</span><span>${stats.glucose.mean}</span></p>
      <p class="stat-row"><span>n</span><span>${stats.glucose.count}</span></p>
    </div>
    <div class="stat-card">
      <p class="stat-name">GKI</p>
      <p class="stat-row"><span>min</span><span>${stats.gki.min}</span></p>
      <p class="stat-row"><span>max</span><span>${stats.gki.max}</span></p>
      <p class="stat-row"><span>mean</span><span>${stats.gki.mean}</span></p>
      <p class="stat-row"><span>n</span><span>${stats.gki.count}</span></p>
    </div>
    <div class="stat-card">
      <p class="stat-name">Seizures</p>
      <p class="stat-row"><span>total</span><span>${totalSeizures}</span></p>
      <p class="stat-row"><span>combined</span><span>${Math.round(totalDur/60)} min</span></p>
      <p class="stat-row"><span>avg</span><span>${totalSeizures ? Math.round(totalDur/totalSeizures) : 0} sec</span></p>
      <p class="stat-row"><span>per day</span><span>${(totalSeizures/days).toFixed(2)}</span></p>
    </div>
  `;

  // Charts
  const ketoneSeries  = KCCharts.dailyAverages(measurements, 'bloodKetone', fromMs, toMs);
  const glucoseSeries = KCCharts.dailyAverages(measurements, 'glucose', fromMs, toMs);
  const gkiSeries     = KCCharts.dailyAverages(
    measurements,
    (r) => (r.bloodKetone && r.glucose ? r.glucose / r.bloodKetone : null),
    fromMs, toMs
  );
  const seizureSeries = KCCharts.dailyCounts(seizures, fromMs, toMs);

  const settings = state.settings || await KCDB.getSettings();

  KCCharts.lineChart('chartKetone', ketoneSeries.labels, ketoneSeries.data, KCCharts.COLORS.sageDeep,
    (settings.ketoneMin && settings.ketoneMax) ? { min: settings.ketoneMin, max: settings.ketoneMax } : null);
  KCCharts.lineChart('chartGlucose', glucoseSeries.labels, glucoseSeries.data, KCCharts.COLORS.honey, null);
  KCCharts.lineChart('chartGKI', gkiSeries.labels, gkiSeries.data, KCCharts.COLORS.terra,
    (settings.gkiMin != null && settings.gkiMax != null) ? { min: settings.gkiMin, max: settings.gkiMax } : null);
  KCCharts.barChart('chartSeizures', seizureSeries.labels, seizureSeries.data, KCCharts.COLORS.terraDeep);
}

/* =====================================================
   EXPORT SCREEN
   ===================================================== */

function initExportScreen() {
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30*86400000);
  const fmt = (d) => {
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };
  const fromEl = document.getElementById('exportFrom');
  const toEl = document.getElementById('exportTo');
  if (!fromEl.value) fromEl.value = fmt(monthAgo);
  if (!toEl.value)   toEl.value = fmt(today);
}

function getExportRange() {
  const from = document.getElementById('exportFrom').value;
  const to   = document.getElementById('exportTo').value;
  const fromMs = from ? new Date(from + 'T00:00:00').getTime() : 0;
  const toMs   = to   ? new Date(to   + 'T23:59:59').getTime() : Date.now();
  return { fromMs, toMs };
}

/* =====================================================
   SETTINGS
   ===================================================== */

async function populateSettingsForm() {
  const s = await KCDB.getSettings();
  state.settings = s;
  document.getElementById('settingChildName').value = s.childName || '';
  document.getElementById('settingDOB').value = s.dob || '';
  selectChipValue('settingVariant', s.variant);
  state.selectedSettingVariant = s.variant;
  selectChipValue('settingDefaultKetone', s.defaultKetone);
  state.selectedSettingDefaultKetone = s.defaultKetone;
  document.getElementById('settingKetoneMin').value = s.ketoneMin ?? '';
  document.getElementById('settingKetoneMax').value = s.ketoneMax ?? '';
  document.getElementById('settingGKIMin').value = s.gkiMin ?? '';
  document.getElementById('settingGKIMax').value = s.gkiMax ?? '';
  renderReminderList(s.reminders || []);
}

function renderReminderList(reminders) {
  const list = document.getElementById('reminderList');
  list.innerHTML = '';
  reminders.forEach((time, i) => {
    const row = document.createElement('div');
    row.className = 'reminder-row';
    row.innerHTML = `
      <input type="time" value="${time}" data-idx="${i}" />
      <button type="button" class="reminder-remove" data-remove="${i}" aria-label="Remove">×</button>
    `;
    list.appendChild(row);
  });
}

function getReminderTimes() {
  return [...document.querySelectorAll('#reminderList input[type="time"]')]
    .map(i => i.value).filter(Boolean);
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const settings = {
    childName: document.getElementById('settingChildName').value.trim(),
    dob: document.getElementById('settingDOB').value,
    variant: state.selectedSettingVariant,
    defaultKetone: state.selectedSettingDefaultKetone,
    ketoneMin: parseFloat(document.getElementById('settingKetoneMin').value) || null,
    ketoneMax: parseFloat(document.getElementById('settingKetoneMax').value) || null,
    gkiMin: parseFloat(document.getElementById('settingGKIMin').value) || null,
    gkiMax: parseFloat(document.getElementById('settingGKIMax').value) || null,
    reminders: getReminderTimes()
  };
  await KCDB.saveSettings(settings);
  state.settings = settings;
  scheduleReminders(settings.reminders);
  toast('Settings saved');
  navigateTo('home');
}

/* =====================================================
   REMINDERS (local notifications)
   ===================================================== */

async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied')  return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

let _reminderTimers = [];
function scheduleReminders(times) {
  _reminderTimers.forEach(t => clearTimeout(t));
  _reminderTimers = [];
  if (!times || !times.length) return;
  ensureNotificationPermission();

  for (const t of times) {
    const [hh, mm] = t.split(':').map(Number);
    const next = new Date();
    next.setHours(hh, mm, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - Date.now();
    _reminderTimers.push(setTimeout(() => {
      showReminder(t);
      // Reschedule for the next day
      scheduleReminders(getReminderTimes());
    }, delay));
  }
}

function showReminder(time) {
  if (Notification.permission === 'granted') {
    new Notification('KetoCare reminder', {
      body: `Time to check ketones (${time})`,
      icon: 'icon.png'
    });
  } else {
    toast(`Reminder: time to check ketones (${time})`);
  }
}

/* =====================================================
   IMPORT JSON
   ===================================================== */

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Restoring will replace ALL current data. Continue?')) {
    e.target.value = '';
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await KCDB.importAll(data);
    toast('Backup restored');
    state.settings = await KCDB.getSettings();
    navigateTo('home');
  } catch (err) {
    alert('Could not import file: ' + err.message);
  }
  e.target.value = '';
}

/* =====================================================
   INIT
   ===================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  state.settings = await KCDB.getSettings();

  // First-time setup nudge
  if (!state.settings.childName) {
    setTimeout(() => {
      toast('Tap settings to add child profile');
    }, 600);
  }

  // Navigation buttons (any element with data-go)
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-go]');
    if (btn && !e.target.closest('form')) {
      e.preventDefault();
      navigateTo(btn.dataset.go);
    }
  });

  // Timer
  document.getElementById('timerStartBtn').addEventListener('click', startTimer);
  document.getElementById('timerStopBtn').addEventListener('click', stopTimer);
  document.getElementById('manualEntryBtn').addEventListener('click', manualSeizureEntry);

  // Seizure form chips
  setupChipGroup('seizureType', false, (v) => { state.selectedSeizureType = v; });
  setupChipGroup('seizureTriggers', true, (v) => { state.selectedSeizureTriggers = v; });

  document.getElementById('seizureForm').addEventListener('submit', handleSeizureSubmit);

  // Live duration display
  ['seizureMinutes', 'seizureSeconds'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const m = parseInt(document.getElementById('seizureMinutes').value, 10) || 0;
      const s = parseInt(document.getElementById('seizureSeconds').value, 10) || 0;
      document.getElementById('seizureDurationDisplay').textContent = `${m}m ${s}s`;
    });
  });

  // Measurement form
  setupChipGroup('ketoneMethod', false, (v) => {
    state.selectedKetoneMethod = v;
    toggleKetoneFields(v);
  });
  setupChipGroup('urineKetone', false, (v) => { state.selectedUrineKetone = v; });
  document.getElementById('measurementForm').addEventListener('submit', handleMeasurementSubmit);
  document.getElementById('bloodKetone').addEventListener('input', updateGKIPreview);
  document.getElementById('glucose').addEventListener('input', updateGKIPreview);

  // History filter
  setupChipGroup('historyFilter', false, (v) => {
    state.selectedHistoryFilter = v;
    renderHistory();
  });
  document.getElementById('historyList').addEventListener('click', handleHistoryItemClick);

  // Trends range
  setupChipGroup('trendRange', false, (v) => {
    state.selectedTrendRange = parseInt(v, 10);
    renderTrends();
  });

  // Settings
  setupChipGroup('settingVariant', false, (v) => { state.selectedSettingVariant = v; });
  setupChipGroup('settingDefaultKetone', false, (v) => { state.selectedSettingDefaultKetone = v; });
  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSubmit);
  document.getElementById('addReminderBtn').addEventListener('click', () => {
    const current = getReminderTimes();
    current.push('08:00');
    renderReminderList(current);
  });
  document.getElementById('reminderList').addEventListener('click', (e) => {
    if (e.target.matches('[data-remove]')) {
      const idx = parseInt(e.target.dataset.remove, 10);
      const current = getReminderTimes();
      current.splice(idx, 1);
      renderReminderList(current);
    }
  });
  document.getElementById('clearDataBtn').addEventListener('click', async () => {
    if (!confirm('This will permanently delete ALL measurements, seizures, and settings. Are you sure?')) return;
    if (!confirm('Last chance — really delete everything?')) return;
    await KCDB.clearAll();
    state.settings = await KCDB.getSettings();
    toast('All data cleared');
    navigateTo('home');
  });

  // Export buttons
  document.getElementById('exportCSVBtn').addEventListener('click', async () => {
    const { fromMs, toMs } = getExportRange();
    await KCExport.exportXLSX(fromMs, toMs);
    toast('Spreadsheet downloaded');
  });
  document.getElementById('exportPDFBtn').addEventListener('click', async () => {
    const { fromMs, toMs } = getExportRange();
    toast('Generating PDF…');
    await KCExport.exportPDF(fromMs, toMs);
    toast('PDF downloaded');
  });
  document.getElementById('exportJSONBtn').addEventListener('click', async () => {
    await KCExport.exportJSON();
    toast('Backup downloaded');
  });
  document.getElementById('importJSON').addEventListener('change', handleImportFile);

  // Schedule reminders if any
  scheduleReminders((state.settings.reminders) || []);

  // Initial render
  renderHome();

  // Register service worker for offline support
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('SW registration failed', err);
      });
    });
  }
});
