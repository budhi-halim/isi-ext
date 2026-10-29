const DATABASE = 'islandsun-debug-capture';

/** Remove obsolete manual recordings; continuous diagnostic history uses a separate database. */
export async function purgeCaptures(account = null) {
  return navigator.locks.request(DATABASE, async () => {
    if (!(await indexedDB.databases()).some(entry => entry.name === DATABASE)) return;
    if (account === null) {
      await new Promise((resolve, reject) => {
        const operation = indexedDB.deleteDatabase(DATABASE);
        operation.onsuccess = resolve;
        operation.onerror = () => reject(operation.error);
        operation.onblocked = resolve;
      });
      return;
    }
    const database = await new Promise((resolve, reject) => {
      const operation = indexedDB.open(DATABASE);
      operation.onsuccess = () => resolve(operation.result);
      operation.onerror = () => reject(operation.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(['sessions', 'events'], 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
        const sessions = transaction.objectStore('sessions');
        sessions.get(account).onsuccess = event => {
          const session = event.target.result;
          sessions.delete(account);
          if (!session) return;
          transaction.objectStore('events').index('session').openCursor(IDBKeyRange.only(session.id)).onsuccess = next => {
            const cursor = next.target.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
          };
        };
      });
    } finally { database.close(); }
  });
}

/** Retry legacy cleanup when the worker starts, including after an older viewer closes. */
export function startCaptureCleanup() {
  void purgeCaptures().catch(() => {});
  void chrome.storage.session.remove('islandsun.debug-capture-active').catch(() => {});
  void chrome.storage.local.remove(['islandsun.connection-diagnostics','islandsun.connection-failures']).catch(() => {});
  void chrome.storage.local.get('islandsun.journal-error').then(saved => {
    const failure = saved['islandsun.journal-error'];
    if (failure && failure.at < Date.now() - 7 * 86400000) return chrome.storage.local.remove('islandsun.journal-error');
  }).catch(() => {});
}
