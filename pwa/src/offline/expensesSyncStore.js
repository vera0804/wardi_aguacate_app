/**
 * Cola local (IndexedDB) para reintentar altas/ediciones cuando falle la red.
 * Namespaces: "lot_expenses" | "general_expenses".
 */

const DB_NAME = 'wardi_expenses_pending';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('lot_expenses')) {
        db.createObjectStore('lot_expenses', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('general_expenses')) {
        db.createObjectStore('general_expenses', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

const STORE = {
  lot_expenses: 'lot_expenses',
  general_expenses: 'general_expenses',
};

export async function enqueuePendingJob(namespace, payload) {
  const storeName = STORE[namespace];
  if (!storeName) throw new Error('namespace inválido');
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(storeName).add({
      namespace,
      payload,
      createdAt: Date.now(),
    });
  });
}

export async function listPendingJobs(namespace) {
  const storeName = STORE[namespace];
  if (!storeName) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const q = tx.objectStore(storeName).getAll();
    q.onsuccess = () => resolve(q.result || []);
    q.onerror = () => reject(q.error);
  });
}

export async function removePendingJob(namespace, id) {
  const storeName = STORE[namespace];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(storeName).delete(id);
  });
}

export async function countPending(namespace) {
  const rows = await listPendingJobs(namespace);
  return rows.length;
}
