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
  selectedHistoryFilter: 'all',
  // v1.5 — Range model
  //
  // Both Trends and Patterns use the same chip set:
  //   Since KD / 7d / 1m / 6m / 1y / Custom
  //
  // selectedTrendRange / selectedPatternsRange holds the active chip value:
  //   - a number of days (7, 30, 180, 365) for the preset chips
  //   - the literal string 'kd' for "Since KD started"
  //   - 'custom' implies the customXxxRange object is the active range
  //
  // Custom range overrides the preset chip value when both ends are set.
  // KD range is computed at render-time from settings.kdStartDate.
  //
  // Defaults: Trends = '30' (1 month), Patterns = '365' (1 year). If a
  // KD start date is set on first load, both default to 'kd' so the
  // user lands on the most useful view for clinic prep.
  selectedTrendRange: 30,
  selectedTrendView: 'split',
  customTrendRange: { fromMs: null, toMs: null },

  selectedPatternsRange: 365,
  customPatternsRange: { fromMs: null, toMs: null },

  selectedSettingVariant: 'classical-4-1'
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
  // v1.5 — Settings may have changed since last Home render (e.g. user added
  // a KD start date in Settings). Reflect that in the chip availability.
  refreshKdChipVisibility();
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

  // v1.4 — keep the small "Running vX.X" footer in sync
  renderHomeVersionLabel();
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
  state.editingMeasurementId = null;
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

  // v1.5 — blood-only input. When editing, preserve any legacy urineKetone
  // value that was logged in v1.4 or earlier so we don't silently drop it.
  let existingUrineKetone = null;
  if (state.editingMeasurementId) {
    const all = await KCDB.getAllMeasurements();
    const existing = all.find(m => m.id === state.editingMeasurementId);
    if (existing && existing.urineKetone != null) {
      existingUrineKetone = existing.urineKetone;
    }
  }

  const record = {
    timestamp,
    bloodKetone: null,
    urineKetone: existingUrineKetone, // preserved if present on the edited record
    glucose: null,
    notes: document.getElementById('measureNotes').value.trim(),
    createdAt: Date.now()
  };

  const k = parseFloat(document.getElementById('bloodKetone').value);
  if (!isNaN(k)) record.bloodKetone = k;

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
    if (rec.bloodKetone != null) {
      document.getElementById('bloodKetone').value = rec.bloodKetone;
    }
    // Older records may still have a urineKetone field (v1.4 and earlier).
    // We don't surface it in the edit form anymore (v1.5 removed urine input)
    // but we don't delete it either — see handleMeasurementSubmit for the
    // same preservation behaviour on save.
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
   v1.5 — Range resolution

   Both Trends and Patterns share the chip set:
     Since KD / 7d / 1m / 6m / 1y / Custom

   resolveRange() takes the active chip value + optional custom range and
   returns the actual { fromMs, toMs, days, sourceLabel } used by the
   renderer. sourceLabel is a short human-readable string for chart titles
   and XLSX/PDF headers ("Last 30 days", "Since KD started · 24 May 2023
   to today", "5 Mar – 12 May").

   If the chip is 'kd' but no start date is set, the caller has already
   hidden the chip — but as a safety net we fall back to the preset days.
   ===================================================== */

const RANGE_PRESET_LABELS = {
  '7':   'Last 7 days',
  '30':  'Last month',
  '180': 'Last 6 months',
  '365': 'Last year'
};

function getKdStartMs(settings) {
  const s = settings || state.settings || {};
  if (!s.kdStartDate) return null;
  // Local midnight on the KD start date.
  const ms = new Date(s.kdStartDate + 'T00:00:00').getTime();
  return isNaN(ms) ? null : ms;
}

function resolveRange(chipValue, customRange, settings) {
  const now = Date.now();
  const cust = customRange || { fromMs: null, toMs: null };

  // Custom takes precedence whenever both ends are set.
  if (chipValue === 'custom' || (cust.fromMs != null && cust.toMs != null)) {
    if (cust.fromMs != null && cust.toMs != null) {
      const days = Math.max(1, Math.ceil((cust.toMs - cust.fromMs) / 86400000));
      const fmt = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return {
        fromMs: cust.fromMs,
        toMs: cust.toMs,
        days,
        sourceLabel: `${fmt(cust.fromMs)} to ${fmt(cust.toMs)}`,
        source: 'custom'
      };
    }
    // Custom chip selected but no dates entered yet — fall back to 1y.
    return resolveRange('365', null, settings);
  }

  if (chipValue === 'kd') {
    const kdStart = getKdStartMs(settings);
    if (kdStart != null) {
      const days = Math.max(1, Math.ceil((now - kdStart) / 86400000));
      const fmt = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return {
        fromMs: kdStart,
        toMs: now,
        days,
        sourceLabel: `Since KD started · ${fmt(kdStart)} to today`,
        source: 'kd'
      };
    }
    // KD chip with no start date — shouldn't happen (chip hidden), fall back.
    return resolveRange('30', null, settings);
  }

  // Preset numeric days.
  const days = parseInt(chipValue, 10) || 30;
  return {
    fromMs: now - days * 86400000,
    toMs: now,
    days,
    sourceLabel: RANGE_PRESET_LABELS[String(days)] || `Last ${days} days`,
    source: 'preset'
  };
}

/* =====================================================
   TRENDS
   ===================================================== */

async function renderTrends() {
  const settings = state.settings || await KCDB.getSettings();
  const range = resolveRange(state.selectedTrendRange, state.customTrendRange, settings);
  const { fromMs, toMs, days, sourceLabel } = range;

  // v1.5 — auto-bucket from the range length
  //   ≤7d → daily  · 8–60d → weekly (calendar Mon–Sun)  · >60d → monthly (calendar)
  const { bucket, label: bucketLabel } = KCCharts.autoBucketForDays(days);

  // Show the active range + bucketing in a small subtitle under the chips
  const subtitleEl = document.getElementById('trendRangeSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `${sourceLabel} · ${bucketLabel}`;
  }

  const measurements = await KCDB.getMeasurementsBetween(fromMs, toMs);
  const seizures     = await KCDB.getSeizuresBetween(fromMs, toMs);

  const ketoneVals = measurements.filter(m => m.bloodKetone).map(m => m.bloodKetone);
  const glucoseVals = measurements.filter(m => m.glucose).map(m => m.glucose);
  const gkiVals = measurements
    .filter(m => m.bloodKetone && m.glucose && m.bloodKetone > 0)
    .map(m => m.glucose / m.bloodKetone);

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

  // Charts — use bucketed series so a 1-year view shows 12 monthly points
  // instead of 365 daily points. Chart renderers are unchanged.
  const ketoneTarget = (settings.ketoneMin && settings.ketoneMax)
    ? { min: settings.ketoneMin, max: settings.ketoneMax } : null;
  const gkiTarget = (settings.gkiMin != null && settings.gkiMax != null)
    ? { min: settings.gkiMin, max: settings.gkiMax } : null;

  if (state.selectedTrendView === 'split') {
    const ketoneSeries  = KCCharts.bucketedMorningEveningSeries(measurements, 'bloodKetone', fromMs, toMs, bucket);
    const glucoseSeries = KCCharts.bucketedMorningEveningSeries(measurements, 'glucose', fromMs, toMs, bucket);
    const gkiSeries     = KCCharts.bucketedMorningEveningSeries(
      measurements,
      (r) => (r.bloodKetone && r.glucose ? r.glucose / r.bloodKetone : null),
      fromMs, toMs, bucket
    );
    KCCharts.lineChartSplit('chartKetone', ketoneSeries,
      KCCharts.COLORS.sage, KCCharts.COLORS.sageDeep, ketoneTarget);
    KCCharts.lineChartSplit('chartGlucose', glucoseSeries,
      KCCharts.COLORS.honey, KCCharts.COLORS.honeyDeep, null);
    KCCharts.lineChartSplit('chartGKI', gkiSeries,
      KCCharts.COLORS.terra, KCCharts.COLORS.terraDeep, gkiTarget);
  } else {
    // Combined: single value per bucket = bucket mean
    const ketoneSeries  = KCCharts.bucketedSeries(measurements, 'bloodKetone', fromMs, toMs, bucket);
    const glucoseSeries = KCCharts.bucketedSeries(measurements, 'glucose', fromMs, toMs, bucket);
    const gkiSeries     = KCCharts.bucketedSeries(
      measurements,
      (r) => (r.bloodKetone && r.glucose ? r.glucose / r.bloodKetone : null),
      fromMs, toMs, bucket
    );
    KCCharts.lineChartCombined('chartKetone', ketoneSeries, KCCharts.COLORS.sageDeep,
      ketoneTarget, null, { label: 'Ketone' });
    KCCharts.lineChartCombined('chartGlucose', glucoseSeries, KCCharts.COLORS.honey,
      null, null, { label: 'Glucose' });
    KCCharts.lineChartCombined('chartGKI', gkiSeries, KCCharts.COLORS.terra,
      gkiTarget, null, { label: 'GKI' });
  }

  const seizureSeries = KCCharts.bucketedCounts(seizures, fromMs, toMs, bucket);
  KCCharts.barChart('chartSeizures', seizureSeries.labels, seizureSeries.data, KCCharts.COLORS.terraDeep);
}

/* =====================================================
   PATTERNS SCREEN

   Exploratory views for parents/clinicians who want to spot patterns
   in the data. Distinct from the basic Trends screen so the everyday
   "is the number okay?" check stays calm and skimmable.
   ===================================================== */

/* ---------- v1.5: Shared custom date range picker ----------

   A single picker config that drives both the Trends and the Patterns
   custom-range UIs. Each screen has its own state (state.customTrendRange,
   state.customPatternsRange) and its own DOM ids, but the open/apply/cancel
   flow is identical so it lives in one place.

   v1.5 changes from v1.3:
   - No 1-year cap. Long ranges are fine now that the monthly bucketing
     keeps the charts/tables compact.
   - Picker available on both Trends and Patterns (was Patterns-only).
   ============================================================ */

const CUSTOM_RANGE_CONFIGS = {
  trend: {
    wrapId: 'trendCustomRange',
    fromId: 'trendCustomFrom',
    toId:   'trendCustomTo',
    errId:  'trendCustomError',
    chipId: 'trendCustomChip',
    chipGroupSelector: '.chip-group[data-field="trendRange"]',
    getState: () => state.customTrendRange,
    setState: (r) => { state.customTrendRange = r; },
    getSelected: () => state.selectedTrendRange,
    rerender: () => renderTrends()
  },
  patterns: {
    wrapId: 'patternsCustomRange',
    fromId: 'patternsCustomFrom',
    toId:   'patternsCustomTo',
    errId:  'patternsCustomError',
    chipId: 'patternsCustomChip',
    chipGroupSelector: '.chip-group[data-field="patternsRange"]',
    getState: () => state.customPatternsRange,
    setState: (r) => { state.customPatternsRange = r; },
    getSelected: () => state.selectedPatternsRange,
    rerender: () => renderPatterns()
  }
};

function openCustomRangePicker(which) {
  const cfg = CUSTOM_RANGE_CONFIGS[which];
  if (!cfg) return;
  const wrap = document.getElementById(cfg.wrapId);
  const fromEl = document.getElementById(cfg.fromId);
  const toEl = document.getElementById(cfg.toId);
  const errEl = document.getElementById(cfg.errId);
  if (!wrap || !fromEl || !toEl) return;

  const today = new Date();
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const cur = cfg.getState();
  if (cur && cur.fromMs != null && cur.toMs != null) {
    fromEl.value = fmt(new Date(cur.fromMs));
    toEl.value = fmt(new Date(cur.toMs));
  } else {
    // Default: last 90 days as a reasonable starting point for both screens
    fromEl.value = fmt(new Date(today.getTime() - 90 * 86400000));
    toEl.value = fmt(today);
  }
  errEl.classList.add('hidden');
  errEl.textContent = '';
  wrap.classList.remove('hidden');
}

function closeCustomRangePicker(which) {
  const cfg = CUSTOM_RANGE_CONFIGS[which];
  if (!cfg) return;
  document.getElementById(cfg.wrapId).classList.add('hidden');
  // Restore the preset chip's selected state so the user isn't stuck
  // with "Custom..." highlighted after cancelling
  document.querySelectorAll(`${cfg.chipGroupSelector} .chip`).forEach(c => {
    c.classList.toggle('selected', c.dataset.value === String(cfg.getSelected()));
  });
  resetCustomChipLabel(which);
}

function applyCustomRange(which) {
  const cfg = CUSTOM_RANGE_CONFIGS[which];
  if (!cfg) return;
  const fromEl = document.getElementById(cfg.fromId);
  const toEl = document.getElementById(cfg.toId);
  const errEl = document.getElementById(cfg.errId);

  const showErr = (msg) => {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  };

  if (!fromEl.value || !toEl.value) return showErr('Pick both a start and end date.');

  const fromMs = new Date(fromEl.value + 'T00:00:00').getTime();
  const toMs = new Date(toEl.value + 'T23:59:59.999').getTime();

  if (isNaN(fromMs) || isNaN(toMs)) return showErr('Please enter valid dates.');
  if (fromMs > toMs) return showErr('Start date must be on or before end date.');
  if (toMs > Date.now() + 86400000) {
    return showErr('End date can\'t be in the future.');
  }

  cfg.setState({ fromMs, toMs });
  document.getElementById(cfg.wrapId).classList.add('hidden');
  updateCustomChipLabel(which);
  cfg.rerender();
}

// Update the "Custom..." chip to show the loaded range
function updateCustomChipLabel(which) {
  const cfg = CUSTOM_RANGE_CONFIGS[which];
  if (!cfg) return;
  const chip = document.getElementById(cfg.chipId);
  if (!chip) return;
  const r = cfg.getState();
  if (!r || r.fromMs == null || r.toMs == null) {
    resetCustomChipLabel(which);
    return;
  }
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  chip.textContent = `Custom (${fmt(r.fromMs)} – ${fmt(r.toMs)})`;
  document.querySelectorAll(`${cfg.chipGroupSelector} .chip`).forEach(c => {
    c.classList.toggle('selected', c.dataset.value === 'custom');
  });
}

function resetCustomChipLabel(which) {
  const cfg = CUSTOM_RANGE_CONFIGS[which];
  if (!cfg) return;
  const chip = document.getElementById(cfg.chipId);
  if (chip) chip.textContent = 'Custom…';
}

/* Wrappers kept for any leftover call sites */
function openPatternsCustomRangePicker()   { openCustomRangePicker('patterns'); }
function closePatternsCustomRangePicker()  { closeCustomRangePicker('patterns'); }
function applyPatternsCustomRange()        { applyCustomRange('patterns'); }
function updatePatternsCustomChipLabel()   { updateCustomChipLabel('patterns'); }
function resetPatternsCustomChipLabel()    { resetCustomChipLabel('patterns'); }

/* ---------- Show/hide "Since KD" chip based on whether kdStartDate is set ---------- */

// Tracks whether the KD chip is currently visible. Used to detect the
// transition from "no KD set" → "KD just set" so we can switch the default
// range to 'kd' on that moment (but not on every subsequent settings save,
// which would override a user's explicit chip choice).
let _kdChipWasVisible = false;

function refreshKdChipVisibility() {
  const kdStart = getKdStartMs(state.settings);
  const hasKd = kdStart != null;
  const trendKd = document.getElementById('trendKdChip');
  const patternsKd = document.getElementById('patternsKdChip');
  if (trendKd) trendKd.classList.toggle('hidden', !hasKd);
  if (patternsKd) patternsKd.classList.toggle('hidden', !hasKd);

  // v1.5.2 — Transition handling.
  //
  // KD just BECAME available (off → on): bump the active range on Trends
  // and Patterns to 'kd' so the user lands on the most useful view next
  // time they open those screens. Only triggers on the off→on edge so a
  // user who has explicitly chosen "1m" or similar doesn't get
  // overridden every time they save Settings.
  //
  // KD just BECAME unavailable (on → off): drop any 'kd' selection back
  // to the v1.4-style defaults so we don't have a selected chip pointing
  // at nothing.
  if (hasKd && !_kdChipWasVisible) {
    state.selectedTrendRange = 'kd';
    state.selectedPatternsRange = 'kd';
    syncRangeChipSelection('trendRange', 'kd');
    syncRangeChipSelection('patternsRange', 'kd');
  } else if (!hasKd) {
    if (state.selectedTrendRange === 'kd') {
      state.selectedTrendRange = 30;
      syncRangeChipSelection('trendRange', 30);
    }
    if (state.selectedPatternsRange === 'kd') {
      state.selectedPatternsRange = 365;
      syncRangeChipSelection('patternsRange', 365);
    }
  }
  _kdChipWasVisible = hasKd;
}

// Mark the chip matching `value` as selected in the named chip group; clear
// selection on all others. Custom-range chip is handled by its own helpers.
function syncRangeChipSelection(groupField, value) {
  const target = String(value);
  document.querySelectorAll(`.chip-group[data-field="${groupField}"] .chip`).forEach(c => {
    c.classList.toggle('selected', c.dataset.value === target);
  });
}


async function renderPatterns() {
  const settings = state.settings || await KCDB.getSettings();
  const range = resolveRange(state.selectedPatternsRange, state.customPatternsRange, settings);
  const { fromMs, toMs, days, sourceLabel } = range;

  // Auto-bucket (≤7d daily, 8–60d weekly, >60d monthly)
  const { bucket, label: bucketLabel } = KCCharts.autoBucketForDays(days);

  // Range subtitle below chips
  const subtitleEl = document.getElementById('patternsRangeSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `${sourceLabel} · ${bucketLabel}`;
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

  // v1.5 — Removed the standalone "Seizures by type" count card. The
  // Total column on the new types table fills the same role.
  document.getElementById('patternsStatGrid').innerHTML = `
    ${patternsStatCard('Ketone (mmol/L)', stats.ketoneAM, stats.ketonePM)}
    ${patternsStatCard('Glucose (mmol/L)', stats.glucoseAM, stats.glucosePM)}
    ${patternsStatCard('GKI', stats.gkiAM, stats.gkiPM)}
    ${patternsSeizureCard(amSeizures.length, pmSeizures.length, days)}
  `;

  // Ketone chart — AM/PM split using the same bucketing as the rest of
  // the screen, with seizure-bucket markers along the baseline.
  const ketoneTarget = (settings.ketoneMin && settings.ketoneMax)
    ? { min: settings.ketoneMin, max: settings.ketoneMax } : null;

  const ketoneSeries = KCCharts.bucketedMorningEveningSeries(measurements, 'bloodKetone', fromMs, toMs, bucket);
  const seizureMarkers = KCCharts.seizureBucketMarkers(seizures, fromMs, toMs, bucket);

  // Hide note line if there are no markers to explain
  const noteEl = document.getElementById('patternsKetoneNote');
  if (noteEl) noteEl.classList.toggle('hidden', seizureMarkers.length === 0);

  KCCharts.lineChartSplit(
    'patternsKetoneChart', ketoneSeries,
    KCCharts.COLORS.sage, KCCharts.COLORS.sageDeep,
    ketoneTarget,
    { markers: seizureMarkers }
  );

  // v1.5 — Seizure types over time as TABLES (replaces v1.3 small-multiples)
  renderSeizureTypesTable(seizures, settings, fromMs, toMs, bucket, bucketLabel);

  // Hour-of-day histogram
  const hourSeries = KCCharts.seizuresByHour(seizures);
  KCCharts.hourHistogramChart('patternsHourChart', hourSeries.data, KCCharts.COLORS.terraDeep);

  // Day-of-week heatmap — unchanged from v1.4 (decision pending)
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
 * v1.5 — Render the seizure types over time as a TABLE (replaces v1.3
 * small-multiples mini-charts). Two stacked tables: frequency (counts per
 * bucket) and duration (median per bucket, blank when no events, "*" when
 * fewer than 3 events). One row per type that appeared in range, sorted
 * by total desc — most-frequent types at the top, matching the dr's
 * spreadsheet layout.
 *
 * Hidden card at <14d range (not enough buckets to be meaningful for a
 * trend view; the count card alternative was removed).
 */
function renderSeizureTypesTable(seizures, settings, fromMs, toMs, bucket, bucketLabel) {
  const card = document.getElementById('patternsTypesCard');
  const titleEl = document.getElementById('patternsTypesTitle');
  const freqWrap = document.getElementById('patternsTypesFrequencyTable');
  const durWrap  = document.getElementById('patternsTypesDurationTable');
  if (!card || !freqWrap || !durWrap) return;

  const days = Math.max(1, Math.ceil((toMs - fromMs) / 86400000));
  if (days < 14) {
    titleEl.textContent = 'Seizure types over time';
    freqWrap.innerHTML = '<p class="types-grid-empty">Available at 14+ days range.</p>';
    durWrap.innerHTML = '';
    return;
  }

  titleEl.textContent = `Seizure types over time — ${bucketLabel}`;

  const table = KCCharts.seizureTypesByPeriodTable(seizures, settings, fromMs, toMs, bucket);

  if (!table.types.length) {
    freqWrap.innerHTML = '<p class="types-grid-empty">No seizures logged in this period.</p>';
    durWrap.innerHTML = '';
    return;
  }

  // Shared header row (column labels = bucket labels + Total)
  const headerCells = table.buckets.map(b =>
    `<th class="type-col${b.isPartial ? ' partial' : ''}" title="${escapeHtml(b.label)}">${escapeHtml(b.label)}</th>`
  ).join('');
  const headerRow = `<thead><tr><th class="type-name-col">Type</th>${headerCells}<th class="type-total-col">Total</th></tr></thead>`;

  // Frequency body
  const freqBody = table.types.map(t => {
    const cells = t.cells.map((c, i) => {
      const isPartial = table.buckets[i].isPartial;
      if (c.count === 0) return `<td class="empty${isPartial ? ' partial' : ''}">—</td>`;
      return `<td${isPartial ? ' class="partial"' : ''}>${c.count}</td>`;
    }).join('');
    return `<tr><th class="type-name-col" title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</th>${cells}<td class="type-total-col"><strong>${t.totalCount}</strong></td></tr>`;
  }).join('');

  // Period totals row at the bottom of the frequency table — matches the
  // parent's spreadsheet style of having a summary row across all months.
  const periodTotals = table.buckets.map((b, i) => {
    const sum = table.types.reduce((acc, t) => acc + (t.cells[i] ? t.cells[i].count : 0), 0);
    return `<td class="period-total${b.isPartial ? ' partial' : ''}">${sum || '—'}</td>`;
  }).join('');
  const grandTotal = table.types.reduce((a, t) => a + t.totalCount, 0);
  const totalsRow = `<tr class="totals-row"><th class="type-name-col">All types</th>${periodTotals}<td class="type-total-col"><strong>${grandTotal}</strong></td></tr>`;

  freqWrap.innerHTML = `
    <table class="types-table">
      ${headerRow}
      <tbody>${freqBody}${totalsRow}</tbody>
    </table>
  `;

  // Duration body — v1.5 update: each cell shows "total (median*)" where
  // total is the sum of all event seconds in the bucket and median is the
  // per-event median. The * follows the median (not the total) and
  // indicates "fewer than 3 events — interpret the median with care".
  // The Total column shows the per-type grand total across the whole range.
  // Two summary rows follow: cross-type Total duration and Median per period.
  const fmt = KCCharts.fmtDurationMmSs;
  const sumOf = (arr) => arr.reduce((a, b) => a + b, 0);
  const medianOf = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2;
  };
  const fmtDurationCell = (durations) => {
    if (!durations || !durations.length) return '—';
    const total = sumOf(durations);
    if (durations.length === 1) {
      return fmt(total);
    }
    const med = medianOf(durations);
    if (durations.length < 3) {
      return `${fmt(total)} <span class="med-paren">(${fmt(med)}<sup>*</sup>)</span>`;
    }
    return `${fmt(total)} <span class="med-paren">(${fmt(med)})</span>`;
  };

  const durBody = table.types.map(t => {
    const cells = t.cells.map((c, i) => {
      const isPartial = table.buckets[i].isPartial;
      const cls = isPartial ? ' partial' : '';
      if (c.count === 0) return `<td class="empty${cls}">—</td>`;
      return `<td class="dur-cell${cls}">${fmtDurationCell(c.durations)}</td>`;
    }).join('');
    // Right-column Total = per-type total seconds across the whole range.
    // Bold so it reads as the "this type's overall load" anchor.
    const totalCell = t.totalDurations.length
      ? `<td class="type-total-col"><strong>${fmt(sumOf(t.totalDurations))}</strong></td>`
      : '<td class="type-total-col">—</td>';
    return `<tr><th class="type-name-col" title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</th>${cells}${totalCell}</tr>`;
  }).join('');

  // Summary rows — cross-type aggregates per bucket.
  // Bucket-level "all events" durations for each bucket index
  const perBucketDurations = table.buckets.map((_, i) =>
    [].concat(...table.types.map(t => t.cells[i].durations))
  );
  const grandAll = [].concat(...table.types.map(t => t.totalDurations));

  const totalRowCells = perBucketDurations.map((arr, i) => {
    const cls = table.buckets[i].isPartial ? ' class="partial"' : '';
    return `<td${cls}>${arr.length ? fmt(sumOf(arr)) : '—'}</td>`;
  }).join('');
  const grandTotalCell = `<td class="type-total-col"><strong>${grandAll.length ? fmt(sumOf(grandAll)) : '—'}</strong></td>`;

  const medianRowCells = perBucketDurations.map((arr, i) => {
    const cls = table.buckets[i].isPartial ? ' partial' : '';
    if (!arr.length) return `<td class="empty ${cls}">—</td>`;
    if (arr.length === 1) return `<td class="${cls}">${fmt(arr[0])}</td>`;
    const med = medianOf(arr);
    const star = arr.length < 3 ? '<sup>*</sup>' : '';
    return `<td class="${cls}">${fmt(med)}${star}</td>`;
  }).join('');
  let grandMedianCell;
  if (!grandAll.length) {
    grandMedianCell = '<td class="type-total-col">—</td>';
  } else {
    const med = medianOf(grandAll);
    const star = grandAll.length < 3 ? '<sup>*</sup>' : '';
    grandMedianCell = `<td class="type-total-col"><strong>${fmt(med)}${star}</strong></td>`;
  }

  const durSummaryRows = `
    <tr class="summary-row"><th class="type-name-col">Total duration</th>${totalRowCells}${grandTotalCell}</tr>
    <tr class="summary-row"><th class="type-name-col">Median per period</th>${medianRowCells}${grandMedianCell}</tr>
  `;

  durWrap.innerHTML = `
    <table class="types-table">
      ${headerRow}
      <tbody>${durBody}${durSummaryRows}</tbody>
    </table>
  `;
}

// Tiny HTML escape used by the new type labels (handles custom labels that
// might contain user-typed angle brackets etc.). See escapeHtml() above.

/* =====================================================
   EXPORT SCREEN
   ===================================================== */

function initExportScreen() {
  const today = new Date();
  const fmt = (d) => {
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };
  const fromEl = document.getElementById('exportFrom');
  const toEl = document.getElementById('exportTo');
  const kdCell = document.getElementById('exportKdCell');
  const kdChip = document.getElementById('exportKdChip');

  const kdStart = getKdStartMs(state.settings);

  // v1.5.2 — Export range row is one row of three cells: [Since KD button]
  // [From input] [To input]. The Since-KD cell is hidden when no KD start
  // date is set, and the row collapses to a normal 2-column field-row in
  // that case (handled in CSS with :has()).
  //
  // The Since-KD button is a quick-fill, not a stateful chip — tapping it
  // fills From with the KD start date and To with today. The button picks
  // up an "active" visual state when the loaded values match those exact
  // dates, so the user can see at a glance that the preset is loaded. The
  // moment the user manually edits either date, the active state clears.

  if (kdStart != null && kdCell) kdCell.classList.remove('hidden');
  else if (kdCell) kdCell.classList.add('hidden');

  // Default fill — fresh visit to the Export screen
  if (!fromEl.value) {
    if (kdStart != null) {
      fromEl.value = state.settings.kdStartDate;
    } else {
      const monthAgo = new Date(today.getTime() - 30*86400000);
      fromEl.value = fmt(monthAgo);
    }
  }
  if (!toEl.value) toEl.value = fmt(today);

  // Both pickers always enabled — Since-KD doesn't lock anything
  fromEl.disabled = false;
  toEl.disabled = false;

  refreshExportKdActiveState();
}

// Mark the Since-KD button as "active" when the loaded From/To values
// match its preset (KD start → today). Clears otherwise.
function refreshExportKdActiveState() {
  const kdChip = document.getElementById('exportKdChip');
  if (!kdChip) return;
  const kdStart = getKdStartMs(state.settings);
  if (kdStart == null) {
    kdChip.classList.remove('active');
    return;
  }
  const fromEl = document.getElementById('exportFrom');
  const toEl = document.getElementById('exportTo');
  if (!fromEl || !toEl) return;
  const todayISO = (() => {
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  })();
  const isActive = fromEl.value === state.settings.kdStartDate && toEl.value === todayISO;
  kdChip.classList.toggle('active', isActive);
}

// Quick-fill From with KD start, To with today.
function handleExportKdClick() {
  const kdStart = getKdStartMs(state.settings);
  if (kdStart == null) return;
  const fromEl = document.getElementById('exportFrom');
  const toEl = document.getElementById('exportTo');
  const today = new Date();
  const pad = n => String(n).padStart(2,'0');
  fromEl.value = state.settings.kdStartDate;
  toEl.value = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  refreshExportKdActiveState();
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
  document.getElementById('settingKdStartDate').value = s.kdStartDate || '';
  selectChipValue('settingVariant', s.variant);
  state.selectedSettingVariant = s.variant;
  document.getElementById('settingCustomRatio').value = s.customRatio || '';
  toggleCustomRatioField(s.variant === 'custom');
  document.getElementById('settingKetoneMin').value = s.ketoneMin ?? '';
  document.getElementById('settingKetoneMax').value = s.ketoneMax ?? '';
  document.getElementById('settingGKIMin').value = s.gkiMin ?? '';
  document.getElementById('settingGKIMax').value = s.gkiMax ?? '';
  document.getElementById('settingKetoneAlertHigh').value = s.ketoneAlertHigh ?? '';
  document.getElementById('settingGlucoseAlertLow').value = s.glucoseAlertLow ?? '';
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

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const settings = {
    // Preserve fields not in the form (welcomeDismissed, reminders, dob, defaultKetone).
    // v1.5 dropped DOB and defaultKetone from the UI but the fields stay on the
    // record so older backups round-trip cleanly.
    ...(state.settings || {}),
    childName: document.getElementById('settingChildName').value.trim(),
    kdStartDate: document.getElementById('settingKdStartDate').value || '',
    variant: state.selectedSettingVariant,
    customRatio: document.getElementById('settingCustomRatio').value.trim(),
    ketoneMin: parseFloat(document.getElementById('settingKetoneMin').value) || null,
    ketoneMax: parseFloat(document.getElementById('settingKetoneMax').value) || null,
    gkiMin: parseFloat(document.getElementById('settingGKIMin').value) || null,
    gkiMax: parseFloat(document.getElementById('settingGKIMax').value) || null,
    ketoneAlertHigh: parseFloat(document.getElementById('settingKetoneAlertHigh').value) || null,
    glucoseAlertLow: parseFloat(document.getElementById('settingGlucoseAlertLow').value) || null,
    customSeizureTypes: getCustomSeizureTypes()
  };
  await KCDB.saveSettings(settings);
  state.settings = settings;
  // Show/hide the "Since KD" chip now that the start date may have changed
  refreshKdChipVisibility();
  toast('Settings saved');
  navigateTo('home');
}

/* =====================================================
   v1.4 — Update visibility

   The service worker quietly caches the app shell so we can work offline,
   which means parents on desktop browsers can get stuck on an old version
   without realising. This block:
     - exposes the running cache name in Settings + About (via APP_VERSION)
     - lets the user trigger a fresh update check with a toast outcome
     - re-checks for updates whenever the tab becomes visible again,
       so a browser that's been backgrounded all day still catches up.
   ===================================================== */

// Single source of truth for the version label shown in-app. Keep in
// sync with CACHE_NAME in sw.js. The "Check for updates" button compares
// against this to decide what to tell the user.
const APP_VERSION = 'v1.5.3';

// Captured by registerServiceWorker() so the button has a reference.
let _swRegistration = null;
// Set to true once we've shown the update banner — used to drive the
// "Check for updates" toast outcome when a new version is already waiting.
let _updateAvailable = false;

// v1.4 — Write the running version into the small footer on the Home
// screen. Called from renderHome() each time Home is shown so the label
// stays in sync if APP_VERSION changes underneath us.
function renderHomeVersionLabel() {
  const el = document.getElementById('homeVersionLabel');
  if (el) el.textContent = APP_VERSION;
}

async function handleCheckForUpdates() {
  const btn = document.getElementById('checkForUpdatesBtn');
  if (!btn) return;
  if (!('serviceWorker' in navigator) || !_swRegistration) {
    toast('Updates not supported on this browser');
    return;
  }
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Checking…';
  try {
    // v1.5.1 — Belt-and-braces: hard-fetch sw.js from network before asking
    // the SW lifecycle to do its update check. This pushes the freshest bytes
    // into the HTTP cache so the update() call below compares apples-to-apples.
    // Some browsers (notably Safari/iOS) used to consult the HTTP cache when
    // doing the SW update check even with updateViaCache: 'none', which led
    // to the user being told "you're on the latest" while v1.5 sat at the
    // server. The hard fetch fixes that.
    //
    // Cache-buster query string defeats any intermediate proxy cache too —
    // GitHub Pages serves sw.js with max-age=600 by default.
    const cacheBuster = '?v=' + Date.now();
    try {
      await fetch('sw.js' + cacheBuster, { cache: 'no-store' });
    } catch (e) {
      // If even the manual fetch fails, the device is probably offline.
      // We still try reg.update() below — that has its own error path.
    }
    await _swRegistration.update();
    // After update() resolves the SW may be installing in the background.
    // We give it a brief moment, then look at what's there.
    setTimeout(() => {
      const waiting = _swRegistration.waiting;
      const installing = _swRegistration.installing;
      if (waiting || _updateAvailable) {
        toast('Update ready — tap Refresh on the banner');
      } else if (installing) {
        toast('Downloading update…');
      } else {
        toast(`You're on the latest version (${APP_VERSION})`);
      }
      btn.disabled = false;
      btn.textContent = originalText;
    }, 1500);
  } catch (err) {
    console.warn('Update check failed', err);
    toast('Couldn\'t reach the server — try again later');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * v1.5.1 — Force refresh. The user's escape hatch when the normal update
 * flow has failed — most commonly on iOS home-screen WebApps, where the
 * service worker lifecycle is genuinely flaky.
 *
 * What it does:
 *   1. Unregister the current service worker.
 *   2. Delete every cache the SW has stored.
 *   3. Hard-reload the page with a cache-buster query string so the very
 *      next request bypasses any browser HTTP cache too.
 *
 * What it preserves:
 *   - IndexedDB data (measurements, seizures, settings). The user's records
 *     are NOT touched. Only the app shell is being reset.
 *
 * The confirmation dialog spells this out before any destruction happens.
 */
async function handleForceRefresh() {
  const ok = confirm(
    'This will reset the app files (the app shell) and reload from the server. ' +
    'Your child\'s records — measurements, seizures, and settings — are NOT affected.\n\n' +
    'Continue?'
  );
  if (!ok) return;
  const btn = document.getElementById('forceRefreshBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Resetting…';
  }
  try {
    // Step 1: unregister all SW registrations for this origin.
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => false)));
    }
    // Step 2: nuke caches.
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
    }
  } catch (e) {
    console.warn('Force refresh cleanup error', e);
  }
  // Step 3: hard reload with a cache-buster. We use replace() rather than
  // assign() so the user's history doesn't have the busted URL in it.
  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Date.now()));
  window.location.replace(url.toString());
}

function toggleWhatsNewPanel() {
  const btn = document.getElementById('whatsNewToggle');
  const panel = document.getElementById('whatsNewPanel');
  if (!btn || !panel) return;
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  btn.setAttribute('aria-expanded', String(!isOpen));
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

  // v1.5.2 — refreshKdChipVisibility handles both showing the "Since KD" chip
  // and setting the default range to 'kd' on the off→on transition (which
  // includes initial load when KD is already set). No further bootstrap
  // is needed here.
  refreshKdChipVisibility();

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

  // Measurement form — v1.5: blood-only, no method toggle
  document.getElementById('measurementForm').addEventListener('submit', handleMeasurementSubmit);
  document.getElementById('bloodKetone').addEventListener('input', updateGKIPreview);
  document.getElementById('glucose').addEventListener('input', updateGKIPreview);

  // History filter
  setupChipGroup('historyFilter', false, (v) => {
    state.selectedHistoryFilter = v;
    renderHistory();
  });
  document.getElementById('historyList').addEventListener('click', handleHistoryItemClick);

  // v1.5 — Generic range chip handler (Trends + Patterns share the same logic)
  const setupRangeChips = (groupField, openPicker, customClearer, applyRange, rerender) => {
    setupChipGroup(groupField, false, (v) => {
      if (v === 'custom') {
        openPicker();
        return;
      }
      customClearer();
      applyRange(v);
      rerender();
    });
  };

  setupRangeChips(
    'trendRange',
    () => openCustomRangePicker('trend'),
    () => {
      state.customTrendRange = { fromMs: null, toMs: null };
      document.getElementById('trendCustomRange').classList.add('hidden');
      resetCustomChipLabel('trend');
    },
    (v) => { state.selectedTrendRange = (v === 'kd') ? 'kd' : parseInt(v, 10); },
    renderTrends
  );
  // Trends view: split (AM vs PM, default) or combined fallback
  setupChipGroup('trendView', false, (v) => {
    state.selectedTrendView = v;
    renderTrends();
  });
  setupRangeChips(
    'patternsRange',
    () => openCustomRangePicker('patterns'),
    () => {
      state.customPatternsRange = { fromMs: null, toMs: null };
      document.getElementById('patternsCustomRange').classList.add('hidden');
      resetCustomChipLabel('patterns');
    },
    (v) => { state.selectedPatternsRange = (v === 'kd') ? 'kd' : parseInt(v, 10); },
    renderPatterns
  );

  // v1.5 — Custom range picker buttons (Trends + Patterns)
  const wireCustomPicker = (which, applyId, cancelId) => {
    const applyBtn  = document.getElementById(applyId);
    const cancelBtn = document.getElementById(cancelId);
    if (applyBtn)  applyBtn.addEventListener('click',  () => applyCustomRange(which));
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeCustomRangePicker(which));
  };
  wireCustomPicker('trend',    'trendCustomApply',    'trendCustomCancel');
  wireCustomPicker('patterns', 'patternsCustomApply', 'patternsCustomCancel');

  // v1.5.2 — Export Since-KD quick-fill button + date input listeners.
  // The button fills From/To with KD-start / today. The input listeners
  // clear the button's "active" sage tint as soon as either date changes.
  const exportKdBtn = document.getElementById('exportKdChip');
  if (exportKdBtn) exportKdBtn.addEventListener('click', handleExportKdClick);
  const exportFromEl = document.getElementById('exportFrom');
  const exportToEl   = document.getElementById('exportTo');
  if (exportFromEl) exportFromEl.addEventListener('change', refreshExportKdActiveState);
  if (exportToEl)   exportToEl.addEventListener('change',   refreshExportKdActiveState);

  // Settings
  setupChipGroup('settingVariant', false, (v) => {
    state.selectedSettingVariant = v;
    toggleCustomRatioField(v === 'custom');
  });
  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSubmit);

  // v1.4 — Updates block
  document.getElementById('checkForUpdatesBtn').addEventListener('click', handleCheckForUpdates);

  // v1.5.1 — Force-refresh escape hatch (Home screen footer)
  const forceBtn = document.getElementById('forceRefreshBtn');
  if (forceBtn) forceBtn.addEventListener('click', handleForceRefresh);

  // v1.5 — Abbreviations expandable panel on About page
  const abbrevToggle = document.getElementById('abbrevToggle');
  const abbrevPanel  = document.getElementById('abbrevPanel');
  if (abbrevToggle && abbrevPanel) {
    abbrevToggle.addEventListener('click', () => {
      const hidden = abbrevPanel.classList.toggle('hidden');
      abbrevToggle.setAttribute('aria-expanded', String(!hidden));
    });
  }

  // v1.5.3 — Data-loss conditions expandable panel on About page.
  // Same toggle pattern as abbreviations / what's-new.
  const dataLossToggle = document.getElementById('dataLossToggle');
  const dataLossPanel  = document.getElementById('dataLossPanel');
  if (dataLossToggle && dataLossPanel) {
    dataLossToggle.addEventListener('click', () => {
      const hidden = dataLossPanel.classList.toggle('hidden');
      dataLossToggle.setAttribute('aria-expanded', String(!hidden));
    });
  }

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
    refreshKdChipVisibility();
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

  // v1.4 — What's new toggle
  const whatsNewBtn = document.getElementById('whatsNewToggle');
  if (whatsNewBtn) whatsNewBtn.addEventListener('click', toggleWhatsNewPanel);

  // v1.4 — Re-check for SW updates when the tab is brought back to focus.
  // Catches the desktop case where a parent leaves the tab open for days;
  // without this, Chrome can cling to the old SW indefinitely.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (_swRegistration) _swRegistration.update().catch(() => {});
  });

  // Initial render
  renderHome();

  // Register service worker for offline support + update detection
  if ('serviceWorker' in navigator) {
    // v1.5.1 — updateViaCache: 'none' tells the browser NEVER to use the HTTP
    // cache when fetching sw.js (or files in importScripts) for update checks.
    // Without this, a freshly-deployed sw.js can sit "hidden" behind a stale
    // HTTP cache entry for up to the Cache-Control max-age — which is why a
    // parent on iOS or desktop Chrome could check for updates and be told
    // "you're on the latest" while the server was actually serving v1.5.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      _swRegistration = reg;
      // Check for updates each time the app starts
      reg.update().catch(() => {});

      // If a new SW is already waiting (installed but not yet active), show banner now
      if (reg.waiting && navigator.serviceWorker.controller) {
        _updateAvailable = true;
        showUpdateBanner(reg.waiting);
      }

      // Listen for new SWs starting to install
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          // 'installed' + an existing controller means an update has arrived
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            _updateAvailable = true;
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
