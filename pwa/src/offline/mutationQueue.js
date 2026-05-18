/**
 * Cola IndexedDB de mutaciones API (POST/PATCH/…) para módulos offline.
 * Gastos por lote/general usan expensesSyncStore.
 */

const DB_NAME = 'wardi_offline_mutations';
const STORE = 'mutations';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function enqueueMutation({ path, method, body, headers }) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).add({
      path,
      method: String(method || 'POST').toUpperCase(),
      body: body ?? null,
      headers: headers ?? null,
      createdAt: Date.now(),
    });
  });
}

export async function listMutations() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const q = tx.objectStore(STORE).getAll();
    q.onsuccess = () => resolve(q.result || []);
    q.onerror = () => reject(q.error);
  });
}

export async function removeMutation(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).delete(id);
  });
}

export async function countMutations() {
  const rows = await listMutations();
  return rows.length;
}
