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
  // 'split' (AM vs PM, default) or 'combined' fallback
  selectedTrendView: 'split',
  selectedPatternsRange: 90,
  // v1.3 — custom date range on Patterns. When fromMs/toMs are set the
  // chip group shows "Custom (X–Y)" and selectedPatternsRange is ignored.
  customPatternsRange: { fromMs: null, toMs: null },
  selectedSettingVariant: 'classical-4-1',
  selectedSettingDefaultKetone: 'blood'
};

/* =====================================================
   Alert helpers — hyperketosis / hypoglycaemia

   Thresholds come from settings (configurable per centre).
   Defaults: ketone >= 6, glucose < 3.
   ===================================================== */

function isKetoneAlert(value, settings) {
  if (value == null || isNaN(value)) return false;
  const threshold = settings?.ketoneAlertHigh;
  if (threshold == null) return false;
  return value >= threshold;
}

function isGlucoseAlert(value, settings) {
  if (value == null || isNaN(value)) return false;
  const threshold = settings?.glucoseAlertLow;
  if (threshold == null) return false;
  return value < threshold;
}

const ALERT_MESSAGE = "Give treatment as per management plan.";

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
  if (screenName === 'patterns')     renderPatterns();
  if (screenName === 'export')       initExportScreen();
  if (screenName === 'settings')     populateSettingsForm();
  if (screenName === 'seizure-timer') resetTimer();
  if (screenName === 'measurement')   resetMeasurementForm();
}

async function dismissWelcome(opts = {}) {
  state.settings.welcomeDismissed = true;
  await KCDB.saveSettings(state.settings);
  if (!opts.skipNavigate) navigateTo('home');
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
  const ketoneStat = ketoneEl.parentElement;
  ketoneStat.classList.remove('in-range', 'out-range', 'alert');

  if (lastWithBlood) {
    ketoneEl.textContent = lastWithBlood.bloodKetone.toFixed(1);
    const v = lastWithBlood.bloodKetone;
    if (isKetoneAlert(v, settings)) {
      ketoneStat.classList.add('alert');
    } else if (settings.ketoneMin != null && settings.ketoneMax != null) {
      if (v >= settings.ketoneMin && v <= settings.ketoneMax) {
        ketoneStat.classList.add('in-range');
      } else {
        ketoneStat.classList.add('out-range');
      }
    }
  } else if (lastWithUrine) {
    ketoneEl.textContent = KCExport.urineLabel(lastWithUrine.urineKetone);
  } else {
    ketoneEl.textContent = '—';
  }

  const glucoseEl = el('todayGlucose');
  const glucoseStat = glucoseEl.parentElement;
  glucoseStat.classList.remove('in-range', 'out-range', 'alert');
  if (lastGluc) {
    glucoseEl.textContent = lastGluc.glucose.toFixed(1);
    if (isGlucoseAlert(lastGluc.glucose, settings)) {
      glucoseStat.classList.add('alert');
    }
  } else {
    glucoseEl.textContent = '—';
  }

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

  // Re-render the chip group so user-defined custom types appear alongside the standard ones
  renderSeizureTypeChips();

  // Reset chip selections
  document.querySelectorAll('.chip-group[data-field="seizureType"] .chip').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.chip-group[data-field="seizureTriggers"] .chip').forEach(c => c.classList.remove('selected'));
  state.selectedSeizureType = seizure.type || null;
  state.selectedSeizureTriggers = seizure.triggers || [];
  if (seizure.type) selectChipValue('seizureType', seizure.type);
  if (seizure.triggers) selectChipValues('seizureTriggers', seizure.triggers);

  // "Other" free-text — only shown when type === 'other'
  document.getElementById('seizureTypeOther').value = seizure.typeOther || '';
  toggleSeizureTypeOtherField(state.selectedSeizureType === 'other');

  document.getElementById('seizureRescue').value  = seizure.rescueMed || '';
  document.getElementById('seizureRecovery').value = seizure.recoveryMin != null ? seizure.recoveryMin : '';
  document.getElementById('seizureNotes').value    = seizure.notes || '';
}

/**
 * Render seizure-type chips: standard built-ins + user-defined custom labels.
 * Custom labels are stored in state.settings.customSeizureTypes as plain strings.
 * Their data-value uses the prefix "custom:" so we can recognise them later
 * without colliding with the standard type values.
 */
function renderSeizureTypeChips() {
  const group = document.querySelector('.chip-group[data-field="seizureType"]');
  if (!group) return;

  const STANDARD = [
    { value: 'tonic-clonic', label: 'Tonic-clonic' },
    { value: 'absence',      label: 'Absence' },
    { value: 'myoclonic',    label: 'Myoclonic' },
    { value: 'focal',        label: 'Focal' },
    { value: 'drop',         label: 'Drop' }
  ];
  const customs = (state.settings?.customSeizureTypes || []).filter(s => s && s.trim());

  // Rebuild HTML preserving the standard chips, custom chips between them and "Other"
  const chips = [
    ...STANDARD.map(t => `<button type="button" class="chip" data-value="${t.value}">${escapeHtml(t.label)}</button>`),
    ...customs.map((label, i) =>
      `<button type="button" class="chip" data-value="custom:${i}">${escapeHtml(label)}</button>`),
    `<button type="button" class="chip" data-value="other">Other</button>`
  ];
  group.innerHTML = chips.join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function toggleSeizureTypeOtherField(show) {
  document.getElementById('seizureTypeOtherField').classList.toggle('hidden', !show);
}

async function handleSeizureSubmit(e) {
  e.preventDefault();
  const startInput = document.getElementById('seizureStartInput').value;
  const startTime  = startInput ? fromLocalInput(startInput) : Date.now();

  const min = parseInt(document.getElementById('seizureMinutes').value, 10) || 0;
  const sec = parseInt(document.getElementById('seizureSeconds').value, 10) || 0;
  let durationSec = min * 60 + sec;
  if (!durationSec && state.pendingSeizure?.durationSec) durationSec = state.pendingSeizure.durationSec;

  const typeOtherValue = document.getElementById('seizureTypeOther').value.trim();

  const record = {
    startTime,
    durationSec: durationSec || 0,
    type: state.selectedSeizureType,
    // Free-text description, only meaningful when type === 'other'
    typeOther: state.selectedSeizureType === 'other' ? typeOtherValue : '',
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
  document.getElementById('measureAlert').classList.add('hidden');

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

  // Evaluate alert thresholds and show banner if either is breached
  updateMeasureAlertBanner(k, g);
}

function updateMeasureAlertBanner(k, g) {
  const banner = document.getElementById('measureAlert');
  const text   = document.getElementById('measureAlertText');
  if (!banner || !text) return;
  const settings = state.settings || {};

  const ketoneHit  = !isNaN(k) && isKetoneAlert(k, settings);
  const glucoseHit = !isNaN(g) && isGlucoseAlert(g, settings);

  if (!ketoneHit && !glucoseHit) {
    banner.classList.add('hidden');
    return;
  }

  let title = '';
  if (ketoneHit && glucoseHit) {
    title = `Ketone ${k.toFixed(1)} mmol/L · Glucose ${g.toFixed(1)} mmol/L`;
  } else if (ketoneHit) {
    title = `High blood ketone (${k.toFixed(1)} mmol/L)`;
  } else {
    title = `Low glucose (${g.toFixed(1)} mmol/L)`;
  }

  text.innerHTML = `<strong>${title}</strong>${ALERT_MESSAGE}`;
  banner.classList.remove('hidden');
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
    const typeLabel = seizureTypeLabel(s);
    return `
      <div class="history-item" data-kind="seizure" data-id="${s.id}">
        <div class="history-icon seizure">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L4.09 12.97a1 1 0 0 0 .77 1.63H11l-1 7.4a.5.5 0 0 0 .9.34L20 11.4a1 1 0 0 0-.77-1.63H13.5L14.5 2.6a.5.5 0 0 0-.9-.34z" stroke-linejoin="round"/></svg>
        </div>
        <div class="history-body">
          <p class="history-title">${escapeHtml(typeLabel)} · ${dur}</p>
          <p class="history-meta">${time}${s.rescueMed ? ' · rescue: ' + escapeHtml(s.rescueMed) : ''}</p>
        </div>
        <button class="history-delete" aria-label="Delete entry">×</button>
      </div>
    `;
  }
}

/**
 * Resolve a human-readable label for a seizure record's type.
 * Thin wrapper over KCCharts.resolveSeizureTypeLabel so the resolver
 * has no dependency on app.js's `state`.
 */
function seizureTypeLabel(s) {
  return KCCharts.resolveSeizureTypeLabel(s, state.settings);
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

  // Stat cards — "readings" instead of "n", which is opaque to non-clinical parents
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
      <p class="stat-row"><span>readings</span><span>${stats.ketone.count}</span></p>
    </div>
    <div class="stat-card">
      <p class="stat-name">Glucose (mmol/L)</p>
      <p class="stat-row"><span>min</span><span>${stats.glucose.min}</span></p>
      <p class="stat-row"><span>max</span><span>${stats.glucose.max}</span></p>
      <p class="stat-row"><span>mean</span><span>${stats.glucose.mean}</span></p>
      <p class="stat-row"><span>readings</span><span>${stats.glucose.count}</span></p>
    </div>
    <div class="stat-card">
      <p class="stat-name">GKI</p>
      <p class="stat-row"><span>min</span><span>${stats.gki.min}</span></p>
      <p class="stat-row"><span>max</span><span>${stats.gki.max}</span></p>
      <p class="stat-row"><span>mean</span><span>${stats.gki.mean}</span></p>
      <p class="stat-row"><span>readings</span><span>${stats.gki.count}</span></p>
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
  const settings = state.settings || await KCDB.getSettings();
  const ketoneTarget = (settings.ketoneMin && settings.ketoneMax)
    ? { min: settings.ketoneMin, max: settings.ketoneMax } : null;
  const gkiTarget = (settings.gkiMin != null && settings.gkiMax != null)
    ? { min: settings.gkiMin, max: settings.gkiMax } : null;

  if (state.selectedTrendView === 'split') {
    const ketoneSeries  = KCCharts.morningEveningSeries(measurements, 'bloodKetone', fromMs, toMs);
    const glucoseSeries = KCCharts.morningEveningSeries(measurements, 'glucose', fromMs, toMs);
    const gkiSeries     = KCCharts.morningEveningSeries(
      measurements,
      (r) => (r.bloodKetone && r.glucose ? r.glucose / r.bloodKetone : null),
      fromMs, toMs
    );
    KCCharts.lineChartSplit(
      'chartKetone', ketoneSeries,
      KCCharts.COLORS.sage, KCCharts.COLORS.sageDeep,
      ketoneTarget
    );
    KCCharts.lineChartSplit(
      'chartGlucose', glucoseSeries,
      KCCharts.COLORS.honey, KCCharts.COLORS.honeyDeep,
      null
    );
    KCCharts.lineChartSplit(
      'chartGKI', gkiSeries,
      KCCharts.COLORS.terra, KCCharts.COLORS.terraDeep,
      gkiTarget
    );
  } else {
    // Combined: single line per chart, all readings on a day averaged
    const ketoneSeries  = KCCharts.dailySeries(measurements, 'bloodKetone', fromMs, toMs);
    const glucoseSeries = KCCharts.dailySeries(measurements, 'glucose', fromMs, toMs);
    const gkiSeries     = KCCharts.dailySeries(
      measurements,
      (r) => (r.bloodKetone && r.glucose ? r.glucose / r.bloodKetone : null),
      fromMs, toMs
    );
    KCCharts.lineChartCombined(
      'chartKetone', ketoneSeries, KCCharts.COLORS.sageDeep,
      ketoneTarget, null, { label: 'Ketone' }
    );
    KCCharts.lineChartCombined(
      'chartGlucose', glucoseSeries, KCCharts.COLORS.honey,
      null, null, { label: 'Glucose' }
    );
    KCCharts.lineChartCombined(
      'chartGKI', gkiSeries, KCCharts.COLORS.terra,
      gkiTarget, null, { label: 'GKI' }
    );
  }

  const seizureSeries = KCCharts.dailyCounts(seizures, fromMs, toMs);
  KCCharts.barChart('chartSeizures', seizureSeries.labels, seizureSeries.data, KCCharts.COLORS.terraDeep);
}

/* =====================================================
   PATTERNS SCREEN

   Exploratory views for parents/clinicians who want to spot patterns
   in the data. Distinct from the basic Trends screen so the everyday
   "is the number okay?" check stays calm and skimmable.
   ===================================================== */

/* ---------- v1.3: Custom date range picker ---------- */

// Cap the upper end of the custom range. 1 year keeps the small-multiples
// grid readable (4 quarterly buckets) and the data-builders fast.
const PATTERNS_CUSTOM_MAX_DAYS = 366;

function openPatternsCustomRangePicker() {
  const wrap = document.getElementById('patternsCustomRange');
  const fromEl = document.getElementById('patternsCustomFrom');
  const toEl = document.getElementById('patternsCustomTo');
  const errEl = document.getElementById('patternsCustomError');
  if (!wrap || !fromEl || !toEl) return;

  // Prefill: if a custom range is already active, show those dates;
  // otherwise use the current preset range as a starting point so the
  // user only needs to nudge the endpoints.
  const today = new Date();
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const cur = state.customPatternsRange;
  if (cur && cur.fromMs != null && cur.toMs != null) {
    fromEl.value = fmt(new Date(cur.fromMs));
    toEl.value = fmt(new Date(cur.toMs));
  } else {
    const days = state.selectedPatternsRange || 90;
    fromEl.value = fmt(new Date(today.getTime() - days * 86400000));
    toEl.value = fmt(today);
  }
  errEl.classList.add('hidden');
  errEl.textContent = '';
  wrap.classList.remove('hidden');
}

function closePatternsCustomRangePicker() {
  document.getElementById('patternsCustomRange').classList.add('hidden');
  // Restore the preset chip's selected state so the user isn't stuck
  // with "Custom..." highlighted after cancelling
  document.querySelectorAll('.chip-group[data-field="patternsRange"] .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.value === String(state.selectedPatternsRange));
  });
  resetPatternsCustomChipLabel();
}

function applyPatternsCustomRange() {
  const fromEl = document.getElementById('patternsCustomFrom');
  const toEl = document.getElementById('patternsCustomTo');
  const errEl = document.getElementById('patternsCustomError');

  const showErr = (msg) => {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  };

  if (!fromEl.value || !toEl.value) return showErr('Pick both a start and end date.');

  // Local-midnight start; end-of-day for the To boundary so a range that
  // includes "today" actually includes everything logged today.
  const fromMs = new Date(fromEl.value + 'T00:00:00').getTime();
  const toMs = new Date(toEl.value + 'T23:59:59.999').getTime();

  if (isNaN(fromMs) || isNaN(toMs)) return showErr('Please enter valid dates.');
  if (fromMs > toMs) return showErr('Start date must be on or before end date.');

  const days = Math.ceil((toMs - fromMs) / 86400000);
  if (days > PATTERNS_CUSTOM_MAX_DAYS) {
    return showErr(`Range too long — please pick up to ${PATTERNS_CUSTOM_MAX_DAYS} days.`);
  }
  if (toMs > Date.now() + 86400000) {
    return showErr('End date can\'t be in the future.');
  }

  state.customPatternsRange = { fromMs, toMs };
  document.getElementById('patternsCustomRange').classList.add('hidden');
  updatePatternsCustomChipLabel();
  renderPatterns();
}

// Update the "Custom..." chip's visible label to "Custom (5 Mar – 12 May)"
// so the user can see what range is loaded without re-opening the picker.
function updatePatternsCustomChipLabel() {
  const chip = document.getElementById('patternsCustomChip');
  if (!chip) return;
  const r = state.customPatternsRange;
  if (!r || r.fromMs == null || r.toMs == null) {
    resetPatternsCustomChipLabel();
    return;
  }
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  chip.textContent = `Custom (${fmt(r.fromMs)} – ${fmt(r.toMs)})`;
  // Mark selected manually since the chip group's data-value is "custom"
  document.querySelectorAll('.chip-group[data-field="patternsRange"] .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.value === 'custom');
  });
}

function resetPatternsCustomChipLabel() {
  const chip = document.getElementById('patternsCustomChip');
  if (chip) chip.textContent = 'Custom…';
}

async function renderPatterns() {
  // v1.3 — range can come from either the preset chips (7/30/90) or a
  // user-picked custom date pair. Custom wins when both ends are set.
  const custom = state.customPatternsRange;
  let fromMs, toMs, days;
  if (custom && custom.fromMs != null && custom.toMs != null) {
    fromMs = custom.fromMs;
    toMs = custom.toMs;
    days = Math.max(1, Math.ceil((toMs - fromMs) / 86400000));
  } else {
    days = state.selectedPatternsRange;
    toMs = Date.now();
    fromMs = toMs - days * 86400000;
  }

  const measurements = await KCDB.getMeasurementsBetween(fromMs, toMs);
  const seizures     = await KCDB.getSeizuresBetween(fromMs, toMs);

  // Split readings into AM (before noon) vs PM (noon and after) based on the
  // same boundary used everywhere else. We then run the same stats on each half.
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

  // Seizure timing split: count by AM vs PM
  const amSeizures = seizures.filter(s => isMorning(s.startTime));
  const pmSeizures = seizures.filter(s => !isMorning(s.startTime));

  const settings = state.settings || await KCDB.getSettings();

  document.getElementById('patternsStatGrid').innerHTML = `
    ${patternsStatCard('Ketone (mmol/L)', stats.ketoneAM, stats.ketonePM)}
    ${patternsStatCard('Glucose (mmol/L)', stats.glucoseAM, stats.glucosePM)}
    ${patternsStatCard('GKI', stats.gkiAM, stats.gkiPM)}
    ${patternsSeizureCard(amSeizures.length, pmSeizures.length, days)}
    ${patternsSeizureTypeCountCard(seizures, settings, days)}
  `;

  // Ketone chart — AM/PM split with seizure-day markers along the baseline
  const ketoneTarget = (settings.ketoneMin && settings.ketoneMax)
    ? { min: settings.ketoneMin, max: settings.ketoneMax } : null;

  const ketoneSeries = KCCharts.morningEveningSeries(measurements, 'bloodKetone', fromMs, toMs);
  const seizureMarkers = KCCharts.seizureDayMarkers(seizures, fromMs, toMs);

  // Hide note line if there are no markers to explain
  const noteEl = document.getElementById('patternsKetoneNote');
  if (noteEl) noteEl.classList.toggle('hidden', seizureMarkers.length === 0);

  KCCharts.lineChartSplit(
    'patternsKetoneChart', ketoneSeries,
    KCCharts.COLORS.sage, KCCharts.COLORS.sageDeep,
    ketoneTarget,
    { markers: seizureMarkers }
  );

  // v1.3 — Seizure types over time (small-multiples frequency + duration)
  renderSeizureTypesOverTime(seizures, settings, fromMs, toMs, days);

  // Hour-of-day histogram
  const hourSeries = KCCharts.seizuresByHour(seizures);
  KCCharts.hourHistogramChart('patternsHourChart', hourSeries.data, KCCharts.COLORS.terraDeep);

  // Day-of-week heatmap — rendered as HTML/CSS, not a Chart.js canvas
  renderHeatmap(seizures, fromMs, toMs, days);

  // Triggers frequency tally
  renderTriggersChart(seizures);
}

/**
 * Render the day-of-week heatmap into #patternsHeatmap.
 * Auto-hides at 7d (not enough rows for the layout to mean anything) and
 * shows a small message instead.
 */
function renderHeatmap(seizures, fromMs, toMs, days) {
  const container = document.getElementById('patternsHeatmap');
  const note = document.getElementById('patternsHeatmapNote');
  if (!container) return;

  // At 7d the heatmap is one row of 7 cells — not a heatmap. Hide.
  if (days < 14) {
    container.innerHTML = '<p class="heatmap-empty-message">Heatmap available at 30d or 90d range.</p>';
    if (note) note.classList.add('hidden');
    return;
  }
  if (note) note.classList.remove('hidden');

  const { weeks, maxCount } = KCCharts.weeklyHeatmap(seizures, fromMs, toMs);
  const dayHeads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Most-recent week at the top — reverse week order
  const orderedWeeks = [...weeks].reverse();

  // Heatmap cell colour: terracotta-deep with opacity proportional to count.
  // 0 keeps the surface treatment (light cream). max → solid terracotta.
  // Min opacity for any non-zero count is bumped so a single seizure is still visible.
  const cellStyle = (count) => {
    if (!count) return '';
    const ratio = maxCount > 0 ? count / maxCount : 0;
    const alpha = 0.20 + ratio * 0.75; // 0.20 (faint) → 0.95 (solid)
    return `background: rgba(168, 90, 72, ${alpha.toFixed(2)}); border-color: transparent; color: ${alpha > 0.55 ? '#fffaf2' : 'var(--ink)'};`;
  };

  const fmtRowLabel = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  const cells = [];
  // Header row: empty corner + Mon..Sun
  cells.push('<div class="heatmap-corner"></div>');
  dayHeads.forEach(h => cells.push(`<div class="heatmap-day-head">${h}</div>`));

  for (const w of orderedWeeks) {
    cells.push(`<div class="heatmap-row-label">${fmtRowLabel(w.weekStartMs)}</div>`);
    for (const d of w.days) {
      if (!d.inRange) {
        cells.push('<div class="heatmap-cell empty"></div>');
      } else {
        const style = cellStyle(d.count);
        const label = d.count > 0 ? d.count : '';
        cells.push(`<div class="heatmap-cell" data-count="${d.count}" style="${style}">${label}</div>`);
      }
    }
  }
  container.innerHTML = cells.join('');
}

/**
 * Render the triggers frequency tally into #patternsTriggersChart.
 * Honest about denominator: every seizure that had no trigger logged
 * shows up as a separate "No trigger noted" bar.
 */
function renderTriggersChart(seizures) {
  const tally = KCCharts.triggerCounts(seizures);
  if (!tally.items.length) {
    // Nothing to render — leave the canvas blank rather than trying to draw an empty chart
    KCCharts.destroyChart('patternsTriggersChart');
    return;
  }
  const labels = tally.items.map(i => i.label);
  const data = tally.items.map(i => i.count);
  KCCharts.horizontalBarChart('patternsTriggersChart', labels, data, KCCharts.COLORS.terraDeep);
}

/**
 * Build a Patterns stat card showing AM vs PM as two columns.
 * Uses a 3-column grid (label, AM value, PM value) so the eye can compare.
 */
function patternsStatCard(name, am, pm) {
  const cell = (s, key) => {
    const v = s[key];
    const empty = (v === '—' || v == null);
    return `<span class="val${empty ? ' empty' : ''}">${v}</span>`;
  };
  return `
    <div class="stat-card">
      <p class="stat-name">${name}</p>
      <div class="stat-table">
        <span></span>
        <span class="col-head">AM</span>
        <span class="col-head">PM</span>
        <span class="row-label">min</span>${cell(am,'min')}${cell(pm,'min')}
        <span class="row-label">max</span>${cell(am,'max')}${cell(pm,'max')}
        <span class="row-label">mean</span>${cell(am,'mean')}${cell(pm,'mean')}
        <span class="row-label">readings</span>
        <span class="val${am.count === 0 ? ' empty' : ''}">${am.count}</span>
        <span class="val${pm.count === 0 ? ' empty' : ''}">${pm.count}</span>
      </div>
    </div>
  `;
}

/** Seizure card variant for the Patterns grid: AM vs PM totals + per day */
function patternsSeizureCard(amCount, pmCount, days) {
  const total = amCount + pmCount;
  const amPerDay = (amCount / days).toFixed(2);
  const pmPerDay = (pmCount / days).toFixed(2);
  return `
    <div class="stat-card">
      <p class="stat-name">Seizures</p>
      <div class="stat-table">
        <span></span>
        <span class="col-head">AM</span>
        <span class="col-head">PM</span>
        <span class="row-label">total</span>
        <span class="val${amCount === 0 ? ' empty' : ''}">${amCount}</span>
        <span class="val${pmCount === 0 ? ' empty' : ''}">${pmCount}</span>
        <span class="row-label">per day</span>
        <span class="val${amCount === 0 ? ' empty' : ''}">${amPerDay}</span>
        <span class="val${pmCount === 0 ? ' empty' : ''}">${pmPerDay}</span>
        <span class="row-label">overall</span>
        <span class="val" style="grid-column: span 2; text-align: right;">${total}</span>
      </div>
    </div>
  `;
}

/**
 * v1.3 — Seizures-by-type count card. Full-width fifth panel in the Patterns
 * stat grid. Shows one row per type with the total over the range. Hidden
 * entirely (returns '') if there are no seizures in the range.
 */
function patternsSeizureTypeCountCard(seizures, settings, days) {
  if (!seizures.length) return '';
  const counts = KCCharts.seizureTypeCounts(seizures, settings);
  if (!counts.length) return '';
  const total = counts.reduce((a, c) => a + c.count, 0);
  const rows = counts.map(c =>
    `<span class="label">${escapeHtml(c.label)}</span><span class="count">${c.count}</span>`
  ).join('');
  return `
    <div class="stat-card stat-card--types">
      <p class="stat-name">Seizures by type</p>
      <div class="types-list">
        ${rows}
        <span class="label muted">Total events</span>
        <span class="count">${total}</span>
      </div>
    </div>
  `;
}

/**
 * v1.3 — Render the small-multiples seizure-types-over-time card.
 * Stacked frequency and duration grids; one mini-chart per type.
 * Hidden card at <14d range (not enough buckets to be meaningful).
 */
function renderSeizureTypesOverTime(seizures, settings, fromMs, toMs, days) {
  const card = document.getElementById('patternsTypesCard');
  const titleEl = document.getElementById('patternsTypesTitle');
  const freqGrid = document.getElementById('patternsTypesFrequencyGrid');
  const durGrid = document.getElementById('patternsTypesDurationGrid');
  if (!card || !freqGrid || !durGrid) return;

  // Below 14 days we don't have enough buckets for a trend view. Hide the
  // whole card and show a small notice so the parent knows it's available
  // at longer ranges.
  if (days < 14) {
    titleEl.textContent = 'Seizure types over time';
    freqGrid.innerHTML = '<p class="types-grid-empty">Available at 14+ days range.</p>';
    durGrid.innerHTML = '';
    return;
  }

  // v1.3 — auto-pick bucket from range length. Same rule used by the
  // Patterns data tab in the XLSX export:
  //   ≤21d    → weekly
  //   22–120d → monthly
  //   >120d   → quarterly (90-day windows)
  // Title shows the active bucketing so the reader knows what each bar means.
  let bucket, bucketLabel;
  if (days <= 21)       { bucket = 'week';    bucketLabel = 'weekly'; }
  else if (days <= 120) { bucket = 'month';   bucketLabel = 'monthly'; }
  else                  { bucket = 'quarter'; bucketLabel = 'quarterly'; }
  titleEl.textContent = `Seizure types over time — ${bucketLabel}`;

  const freqData = KCCharts.seizureTypeFrequencyByType(seizures, settings, fromMs, toMs, bucket);

  if (!freqData.length) {
    freqGrid.innerHTML = '<p class="types-grid-empty">No seizures logged in this period.</p>';
    durGrid.innerHTML = '';
    return;
  }

  // Frequency grid — one cell per type.
  freqGrid.innerHTML = freqData.map((t, i) => `
    <div class="types-grid-cell">
      <h5 title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</h5>
      <p class="types-grid-cell-sub">${t.total} event${t.total === 1 ? '' : 's'} total</p>
      <div class="mini-canvas-wrap"><canvas id="patternsTypesFreq_${i}"></canvas></div>
    </div>
  `).join('');

  // Duration grid — only types that have at least one timed event in range.
  const durData = KCCharts.seizureTypeDurationByType(seizures, settings, fromMs, toMs, bucket);

  if (!durData.length) {
    durGrid.innerHTML = '<p class="types-grid-empty">No timed seizures logged in this period.</p>';
  } else {
    durGrid.innerHTML = durData.map((t, i) => `
      <div class="types-grid-cell">
        <h5 title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</h5>
        <p class="types-grid-cell-sub">${t.totalWithDuration} timed event${t.totalWithDuration === 1 ? '' : 's'}</p>
        <div class="mini-canvas-wrap"><canvas id="patternsTypesDur_${i}"></canvas></div>
      </div>
    `).join('');
  }

  // Render charts after DOM is in place — short defer so Chart.js sees the
  // canvases at their final layout size.
  requestAnimationFrame(() => {
    freqData.forEach((t, i) => {
      KCCharts.seizureTypeSmallMultipleChart(
        `patternsTypesFreq_${i}`, t.buckets, KCCharts.COLORS.terraDeep, 'frequency'
      );
    });
    durData.forEach((t, i) => {
      KCCharts.seizureTypeSmallMultipleChart(
        `patternsTypesDur_${i}`, t.buckets, KCCharts.COLORS.terraDeep, 'duration'
      );
    });
  });
}

// Tiny HTML escape used by the new type labels (handles custom labels that
// might contain user-typed angle brackets etc.). See escapeHtml() above.

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
  document.getElementById('settingCustomRatio').value = s.customRatio || '';
  toggleCustomRatioField(s.variant === 'custom');
  selectChipValue('settingDefaultKetone', s.defaultKetone);
  state.selectedSettingDefaultKetone = s.defaultKetone;
  document.getElementById('settingKetoneMin').value = s.ketoneMin ?? '';
  document.getElementById('settingKetoneMax').value = s.ketoneMax ?? '';
  document.getElementById('settingGKIMin').value = s.gkiMin ?? '';
  document.getElementById('settingGKIMax').value = s.gkiMax ?? '';
  document.getElementById('settingKetoneAlertHigh').value = s.ketoneAlertHigh ?? '';
  document.getElementById('settingGlucoseAlertLow').value = s.glucoseAlertLow ?? '';
  renderReminderList(s.reminders || []);
  renderCustomSeizureTypeList(s.customSeizureTypes || []);
}

function toggleCustomRatioField(show) {
  document.getElementById('customRatioField').classList.toggle('hidden', !show);
}

function renderCustomSeizureTypeList(types) {
  const list = document.getElementById('customSeizureTypeList');
  list.innerHTML = '';
  types.forEach((label, i) => {
    const row = document.createElement('div');
    row.className = 'custom-type-row';
    row.innerHTML = `
      <input type="text" value="${escapeHtml(label)}" data-idx="${i}" placeholder="e.g. Eye blink (focal)" />
      <button type="button" class="custom-type-remove" data-remove-type="${i}" aria-label="Remove">×</button>
    `;
    list.appendChild(row);
  });
}

function getCustomSeizureTypes() {
  return [...document.querySelectorAll('#customSeizureTypeList input[type="text"]')]
    .map(i => i.value.trim()).filter(Boolean);
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
    ...(state.settings || {}),  // preserve fields not in the form (e.g. welcomeDismissed)
    childName: document.getElementById('settingChildName').value.trim(),
    dob: document.getElementById('settingDOB').value,
    variant: state.selectedSettingVariant,
    customRatio: document.getElementById('settingCustomRatio').value.trim(),
    defaultKetone: state.selectedSettingDefaultKetone,
    ketoneMin: parseFloat(document.getElementById('settingKetoneMin').value) || null,
    ketoneMax: parseFloat(document.getElementById('settingKetoneMax').value) || null,
    gkiMin: parseFloat(document.getElementById('settingGKIMin').value) || null,
    gkiMax: parseFloat(document.getElementById('settingGKIMax').value) || null,
    ketoneAlertHigh: parseFloat(document.getElementById('settingKetoneAlertHigh').value) || null,
    glucoseAlertLow: parseFloat(document.getElementById('settingGlucoseAlertLow').value) || null,
    customSeizureTypes: getCustomSeizureTypes(),
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

  // First-time launch: show Welcome screen (replaces the old toast nudge)
  if (!state.settings.welcomeDismissed) {
    navigateTo('welcome');
  } else if (!state.settings.childName) {
    // Returning user who never set a name (e.g. dismissed welcome without going further)
    setTimeout(() => {
      toast('Tap settings to add child profile');
    }, 600);
  }

  // Navigation buttons (any element with data-go)
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-go]');
    if (!btn) return;
    // If the data-go is on/inside a form, only honour it if the trigger is an explicit button (not a submit)
    const inForm = e.target.closest('form');
    if (inForm) {
      // Only allow data-go nav from explicit type="button" buttons (e.g. About link)
      if (btn.tagName !== 'BUTTON' || btn.type === 'submit') return;
    }
    e.preventDefault();
    navigateTo(btn.dataset.go);
  });

  // Timer
  document.getElementById('timerStartBtn').addEventListener('click', startTimer);
  document.getElementById('timerStopBtn').addEventListener('click', stopTimer);
  document.getElementById('manualEntryBtn').addEventListener('click', manualSeizureEntry);

  // Seizure form chips
  setupChipGroup('seizureType', false, (v) => {
    state.selectedSeizureType = v;
    toggleSeizureTypeOtherField(v === 'other');
  });
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
  // Trends view: split (AM vs PM, default) or combined fallback
  setupChipGroup('trendView', false, (v) => {
    state.selectedTrendView = v;
    renderTrends();
  });
  // Patterns range
  setupChipGroup('patternsRange', false, (v) => {
    if (v === 'custom') {
      openPatternsCustomRangePicker();
      return;
    }
    // Preset chip clicked — clear any custom range and re-render
    state.customPatternsRange = { fromMs: null, toMs: null };
    state.selectedPatternsRange = parseInt(v, 10);
    document.getElementById('patternsCustomRange').classList.add('hidden');
    resetPatternsCustomChipLabel();
    renderPatterns();
  });

  // v1.3 — Custom range picker buttons
  const applyBtn = document.getElementById('patternsCustomApply');
  if (applyBtn) applyBtn.addEventListener('click', applyPatternsCustomRange);
  const cancelBtn = document.getElementById('patternsCustomCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closePatternsCustomRangePicker);

  // Settings
  setupChipGroup('settingVariant', false, (v) => {
    state.selectedSettingVariant = v;
    toggleCustomRatioField(v === 'custom');
  });
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

  // Custom seizure types — add / remove
  document.getElementById('addCustomSeizureTypeBtn').addEventListener('click', () => {
    const current = getCustomSeizureTypes();
    current.push('');
    renderCustomSeizureTypeList(current);
    // Focus the new (empty) row
    const inputs = document.querySelectorAll('#customSeizureTypeList input[type="text"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  document.getElementById('customSeizureTypeList').addEventListener('click', (e) => {
    if (e.target.matches('[data-remove-type]')) {
      const idx = parseInt(e.target.dataset.removeType, 10);
      const current = getCustomSeizureTypes();
      // Reading the live values (not just the previously-saved list) means
      // an in-progress edit isn't lost if the user removes a different row.
      current.splice(idx, 1);
      renderCustomSeizureTypeList(current);
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
    toast('Detailed records downloaded');
  });
  document.getElementById('exportPDFBtn').addEventListener('click', async () => {
    const { fromMs, toMs } = getExportRange();
    toast('Generating report…');
    await KCExport.exportPDF(fromMs, toMs);
    toast('Summary report downloaded');
  });
  document.getElementById('exportJSONBtn').addEventListener('click', async () => {
    await KCExport.exportJSON();
    toast('Backup downloaded');
  });
  document.getElementById('importJSON').addEventListener('change', handleImportFile);

  // Welcome screen buttons
  document.getElementById('welcomeGotItBtn').addEventListener('click', dismissWelcome);
  document.getElementById('welcomeLearnMoreBtn').addEventListener('click', async () => {
    await dismissWelcome({ skipNavigate: true });
    navigateTo('about');
  });

  // About screen — re-show welcome
  document.getElementById('showWelcomeAgainBtn').addEventListener('click', async () => {
    state.settings.welcomeDismissed = false;
    await KCDB.saveSettings(state.settings);
    navigateTo('welcome');
  });

  // Schedule reminders if any
  scheduleReminders((state.settings.reminders) || []);

  // Initial render
  renderHome();

  // Register service worker for offline support + update detection
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Check for updates each time the app starts
      reg.update().catch(() => {});

      // If a new SW is already waiting (installed but not yet active), show banner now
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(reg.waiting);
      }

      // Listen for new SWs starting to install
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          // 'installed' + an existing controller means an update has arrived
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });
    }).catch((err) => {
      console.warn('SW registration failed', err);
    });

    // When the new SW takes over, reload so the page uses the new files
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
});

function showUpdateBanner(waitingWorker) {
  const banner = document.getElementById('updateBanner');
  const btn = document.getElementById('updateBannerBtn');
  if (!banner || !btn) return;
  banner.classList.add('show');
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    // Tell the waiting SW to take over; controllerchange handler will reload
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  };
}
