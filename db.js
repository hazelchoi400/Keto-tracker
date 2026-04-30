/* =====================================================
   db.js — IndexedDB wrapper
   Stores: settings, measurements, seizures
   ===================================================== */

const DB_NAME = 'ketocare-db';
const DB_VERSION = 1;

const STORE_SETTINGS     = 'settings';
const STORE_MEASUREMENTS = 'measurements';
const STORE_SEIZURES     = 'seizures';

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_MEASUREMENTS)) {
        const s = db.createObjectStore(STORE_MEASUREMENTS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains(STORE_SEIZURES)) {
        const s = db.createObjectStore(STORE_SEIZURES, { keyPath: 'id', autoIncrement: true });
        s.createIndex('startTime', 'startTime');
      }
    };

    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/* ---------- Settings ---------- */

const DEFAULT_SETTINGS = {
  childName: '',
  dob: '',
  variant: 'classical-4-1',
  defaultKetone: 'blood',
  ketoneMin: 3,
  ketoneMax: 5,
  gkiMin: 1,
  gkiMax: 6,
  reminders: [] // ['07:00', '12:00']
};

async function getSettings() {
  const store = await tx(STORE_SETTINGS);
  const result = await promisify(store.get('app'));
  return result ? { ...DEFAULT_SETTINGS, ...result.value } : { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings) {
  const store = await tx(STORE_SETTINGS, 'readwrite');
  return promisify(store.put({ key: 'app', value: settings }));
}

/* ---------- Measurements ---------- */

async function addMeasurement(record) {
  const store = await tx(STORE_MEASUREMENTS, 'readwrite');
  return promisify(store.add(record));
}

async function updateMeasurement(record) {
  const store = await tx(STORE_MEASUREMENTS, 'readwrite');
  return promisify(store.put(record));
}

async function deleteMeasurement(id) {
  const store = await tx(STORE_MEASUREMENTS, 'readwrite');
  return promisify(store.delete(id));
}

async function getAllMeasurements() {
  const store = await tx(STORE_MEASUREMENTS);
  return promisify(store.getAll());
}

async function getMeasurementsBetween(fromMs, toMs) {
  const all = await getAllMeasurements();
  return all.filter(m => m.timestamp >= fromMs && m.timestamp <= toMs);
}

/* ---------- Seizures ---------- */

async function addSeizure(record) {
  const store = await tx(STORE_SEIZURES, 'readwrite');
  return promisify(store.add(record));
}

async function updateSeizure(record) {
  const store = await tx(STORE_SEIZURES, 'readwrite');
  return promisify(store.put(record));
}

async function deleteSeizure(id) {
  const store = await tx(STORE_SEIZURES, 'readwrite');
  return promisify(store.delete(id));
}

async function getAllSeizures() {
  const store = await tx(STORE_SEIZURES);
  return promisify(store.getAll());
}

async function getSeizuresBetween(fromMs, toMs) {
  const all = await getAllSeizures();
  return all.filter(s => s.startTime >= fromMs && s.startTime <= toMs);
}

/* ---------- Bulk ---------- */

async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE_SETTINGS, STORE_MEASUREMENTS, STORE_SEIZURES], 'readwrite');
    t.objectStore(STORE_SETTINGS).clear();
    t.objectStore(STORE_MEASUREMENTS).clear();
    t.objectStore(STORE_SEIZURES).clear();
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

async function exportAll() {
  const [settings, measurements, seizures] = await Promise.all([
    getSettings(), getAllMeasurements(), getAllSeizures()
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    measurements,
    seizures
  };
}

async function importAll(data) {
  if (!data || data.version !== 1) throw new Error('Invalid backup file');
  await clearAll();
  if (data.settings) await saveSettings(data.settings);
  const measStore = await tx(STORE_MEASUREMENTS, 'readwrite');
  for (const m of (data.measurements || [])) {
    const { id, ...rest } = m;
    measStore.add(rest);
  }
  const seizStore = await tx(STORE_SEIZURES, 'readwrite');
  for (const s of (data.seizures || [])) {
    const { id, ...rest } = s;
    seizStore.add(rest);
  }
}

/* ---------- Calculations ---------- */

function calculateGKI(glucoseMmol, ketoneMmol) {
  if (!glucoseMmol || !ketoneMmol || ketoneMmol <= 0) return null;
  return glucoseMmol / ketoneMmol;
}

window.KCDB = {
  getSettings, saveSettings,
  addMeasurement, updateMeasurement, deleteMeasurement,
  getAllMeasurements, getMeasurementsBetween,
  addSeizure, updateSeizure, deleteSeizure,
  getAllSeizures, getSeizuresBetween,
  clearAll, exportAll, importAll,
  calculateGKI
};
