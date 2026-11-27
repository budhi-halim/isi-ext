/*
 * Checkpoints belong to the extension's local IndexedDB, not the company server.
 * Keep the run cursor and each completed order in the same transaction, so an
 * interrupted write can never advance past an order that was not saved.
 */
const DATABASE = 'islandsun-revenue-checkpoints';
const RUNS = 'runs';
const ORDERS = 'orders';
let opening = null;

function database() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(ORDERS)) {
          const store = db.createObjectStore(ORDERS, { keyPath: ['runKey', 'soNumber'] });
          store.createIndex('byRun', 'runKey', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open saved extraction progress.'));
      request.onblocked = () => reject(new Error('Saved progress is locked by another extension tab. Close other extractor tabs and retry.'));
    }).catch(error => { opening = null; throw error; });
  }
  return opening;
}

async function transact(stores, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Could not store extraction progress.'));
    transaction.onabort = () => reject(transaction.error || new Error('Saving extraction progress was interrupted.'));
    try { action(transaction, value => { result = value; }); }
    catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export function checkpointKey(origin, startMonthVal, endMonthVal) {
  return JSON.stringify([origin, startMonthVal, endMonthVal]);
}

export function loadCheckpoint(key) {
  return transact([RUNS], 'readonly', (tx, set) => {
    const request = tx.objectStore(RUNS).get(key);
    request.onsuccess = () => set(request.result || null);
  });
}

export function latestCheckpoint(origin) {
  return transact([RUNS], 'readonly', (tx, set) => {
    const request = tx.objectStore(RUNS).getAll();
    request.onsuccess = () => {
      const candidates = request.result.filter(run => run.origin === origin);
      candidates.sort((a, b) => b.updatedAt - a.updatedAt);
      set(candidates[0] || null);
    };
  });
}

export function saveCheckpoint(run) {
  run.updatedAt = Date.now();
  return transact([RUNS], 'readwrite', tx => { tx.objectStore(RUNS).put(run); });
}

export function loadSavedOrders(runKey) {
  return transact([ORDERS], 'readonly', (tx, set) => {
    const request = tx.objectStore(ORDERS).index('byRun').getAll(runKey);
    request.onsuccess = () => set(request.result);
  });
}

export function saveCompletedOrder(run, soNumber, soId, rows) {
  run.updatedAt = Date.now();
  return transact([RUNS, ORDERS], 'readwrite', tx => {
    tx.objectStore(ORDERS).put({ runKey: run.key, soNumber, soId, rows });
    tx.objectStore(RUNS).put(run);
  });
}

export function clearCheckpoint(key) {
  return transact([RUNS, ORDERS], 'readwrite', tx => {
    tx.objectStore(RUNS).delete(key);
    const store = tx.objectStore(ORDERS);
    const cursorRequest = store.index('byRun').openKeyCursor(IDBKeyRange.only(key));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
    };
  });
}
