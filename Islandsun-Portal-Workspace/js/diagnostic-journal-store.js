import { capturedText, safeRequestUrl } from './debug-capture-data.js';
import { vaultKey, sealArchiveBytes, openArchiveBytes } from './offline-vault.js';

export const JOURNAL_LIMITS = Object.freeze({ days: 7, events: 150000, incidents:10000, bytes: 128 * 1024 * 1024 });
const DATABASE = 'islandsun-diagnostic-journal';
const encoder = new TextEncoder();
let opening, writes = Promise.resolve();
let generation = 0;
const accountGenerations = new Map();
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const completed = transaction => {
  const promise = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('Diagnostic storage transaction stopped.'));
    transaction.onerror = () => {};
  });
  // A request can fail before its caller reaches the transaction-completion await.
  promise.catch(() => {});
  return promise;
};

async function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, 3);
    request.onupgradeneeded = event => {
      if (event.oldVersion < 1) {
        const events = request.result.createObjectStore('events', { keyPath: 'sequence', autoIncrement: true });
        events.createIndex('at', 'at');
        events.createIndex('account', 'account');
        const bodies = request.result.createObjectStore('bodies', { keyPath: 'key' });
        bodies.createIndex('lastAt', 'lastAt');
        bodies.createIndex('account', 'account');
        request.result.createObjectStore('meta');
      }
      if (event.oldVersion < 2) {
        const incidents = request.result.createObjectStore('incidents', {keyPath:'sequence',autoIncrement:true});
        incidents.createIndex('at','at'); incidents.createIndex('account','account');
      }
      if (event.oldVersion < 3) {
        for (const name of ['events','bodies','incidents']) request.transaction.objectStore(name).createIndex('size','size');
      }
    };
    request.onsuccess = () => {
      const value = request.result;
      if (blocked) { value.close(); return; }
      value.onversionchange = () => { value.close(); opening = null; };
      resolve(value);
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { blocked = true; opening = null; reject(new Error('Close older offline tabs and reopen the extension.')); };
  });
  return opening;
}

function serialize(task) {
  const operation = writes.then(task);
  writes = operation.catch(() => {});
  return operation;
}

function importantEvent(entry) {
  return entry.failure === true || entry.status >= 400 || typeof entry.errorType === 'string'
    || /timeout|http-error|data-error/.test(entry.outcome || '')
    || /failed|error|retry|^submission-|^notification-(?:created|removed|action-saved)|^draft-save|^archive-settings/.test(entry.event)
    || entry.event === 'navigation-state' && entry.durationMs >= 4000;
}

/** Metadata stays available while the archive is locked; response contents remain encrypted. */
export async function appendJournal(account, event, fields = {}, at = Date.now()) {
  const startedGeneration = generation, accountGeneration = accountGenerations.get(account || '') || 0;
  const { body, ...metadata } = fields;
  const entry = { ...diagnosticFields(metadata), at, account: account || '', event };
  let source;
  if (body) {
    const { text, base64, ...description } = body;
    entry.body = description;
    if (typeof text === 'string' || typeof base64 === 'string') {
      const content = typeof text === 'string' ? capturedText(text) : { base64 };
      const bytes = encoder.encode(JSON.stringify(content));
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      const key = JSON.stringify([entry.account, hash]);
      entry.body = { ...description, source: key, storedHash: hash };
      source = { key, account: entry.account, hash, bytes };
    }
  }
  return serialize(async () => {
    if (startedGeneration !== generation || accountGeneration !== (accountGenerations.get(account || '') || 0)) return;
    const db = await database();
    let stored;
    if (source) {
      stored = await result(db.transaction('bodies').objectStore('bodies').get(source.key));
      if (!stored) {
        try {
          const sealed = await sealArchiveBytes(entry.account, source.bytes, `journal:${source.key}`);
          stored = { key: source.key, account: entry.account, hash: source.hash, sealed, size: sealed.data.byteLength + sealed.wrappedKey.length * 4 + 512 };
        } catch (error) {
          delete entry.body.source;
          entry.body.omitted = error.code === 'OFFLINE_LOCKED' ? 'archive-locked' : 'response-storage-unavailable';
        }
      }
    }
    const transaction = db.transaction(['events', 'bodies', 'incidents', 'meta'], 'readwrite'), done = completed(transaction);
    const meta = transaction.objectStore('meta');
    const usage = await result(meta.get('usage')) || { events: 0, bytes: 0, discardedEvents: 0, discardedBodies: 0 };
    if (stored) {
      if (!stored.lastAt) usage.bytes += stored.size;
      transaction.objectStore('bodies').put({ ...stored, lastAt: at });
    }
    const size = encoder.encode(JSON.stringify(entry)).byteLength + 128;
    transaction.objectStore('events').add({ ...entry, size });
    usage.events++; usage.bytes += size;
    if (importantEvent(entry)) {
      transaction.objectStore('incidents').add({...entry,size});
      usage.incidents = (usage.incidents || 0) + 1; usage.bytes += size;
    }
    meta.put(usage, 'usage');
    await done;
    if (usage.events % 128 === 0 || usage.bytes > JOURNAL_LIMITS.bytes || usage.events > JOURNAL_LIMITS.events || usage.incidents > JOURNAL_LIMITS.incidents) await trim(db);
  });
}

async function trim(db) {
  const transaction = db.transaction(['events', 'bodies', 'incidents', 'meta'], 'readwrite'), done = completed(transaction);
  const meta = transaction.objectStore('meta');
  const usage = await result(meta.get('usage')) || { events: 0, bytes: 0, discardedEvents: 0, discardedBodies: 0 };
  const cutoff = Date.now() - JOURNAL_LIMITS.days * 86400000;
  for (const [name, index] of [['bodies', 'lastAt'], ['events', 'at'], ['incidents','at']]) {
    await new Promise((resolve, reject) => {
      const request = transaction.objectStore(name).index(index).openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const old = cursor.value[index] < cutoff;
        const over = usage.bytes > JOURNAL_LIMITS.bytes * 0.9 || name === 'events' && usage.events > JOURNAL_LIMITS.events
          || name === 'incidents' && usage.incidents > JOURNAL_LIMITS.incidents;
        if (!old && !over) { resolve(); return; }
        cursor.delete(); usage.bytes = Math.max(0, usage.bytes - cursor.value.size);
        if (name === 'events') { usage.events--; usage.discardedEvents++; }
        else if (name === 'incidents') { usage.incidents--; usage.discardedIncidents = (usage.discardedIncidents || 0) + 1; }
        else usage.discardedBodies++;
        usage.discardedThrough = Math.max(usage.discardedThrough || 0, cursor.value[index]);
        cursor.continue();
      };
    });
  }
  meta.put(usage, 'usage');
  await done;
}

/** Preserve account preferences before expiring their diagnostic evidence at worker startup. */
export function maintainJournal(restorePreferences = async () => {}) {
  return serialize(async () => {
    const db = await database();
    const rows = await result(db.transaction('incidents').objectStore('incidents').getAll());
    await restorePreferences(rows.filter(row => row.event === 'notification-action-saved' && row.account));
    await trim(db);
  });
}

export function clearJournal(account = null, {onProgress = () => {}} = {}) {
  if (account === null) generation++;
  else accountGenerations.set(account,(accountGenerations.get(account) || 0) + 1);
  return serialize(async () => {
    const db = await database(), transaction = db.transaction(['events', 'bodies', 'incidents', 'meta'], 'readwrite'), done = completed(transaction);
    const names = ['events','bodies','incidents'];
    const keys = account === null ? null : await Promise.all(names.map(name => result(transaction.objectStore(name).index('account').getAllKeys(account))));
    const counts = keys ? keys.map(items => items.length) : await Promise.all(names.map(name => result(transaction.objectStore(name).count())));
    const total = counts.reduce((sum,count) => sum + count,0);
    let removed = 0;
    onProgress({phase:'history',completed:removed,total});
    for (const [index,name] of names.entries()) {
      const store = transaction.objectStore(name);
      const removals = account === null ? [store.clear()] : keys[index].map(key => store.delete(key));
      for (const removal of removals) removal.onsuccess = () => {
        removed += account === null ? counts[index] : 1;
        onProgress({phase:'history',completed:removed,total});
      };
    }
    transaction.objectStore('meta').delete('usage');
    await done;
    onProgress({phase:'recount',completed:0,total:0});
    await recount(db);
  });
}

/** Read only confirmed notification actions for migration; encrypted response bodies stay untouched. */
export async function notificationJournalActions(account) {
  await writes;
  const db = await database();
  const rows = await result(db.transaction('incidents').objectStore('incidents').index('account').getAll(account));
  return rows.filter(row => row.event === 'notification-action-saved' && row.account === account);
}

async function recount(db) {
  const transaction = db.transaction(['events', 'bodies', 'incidents', 'meta'], 'readwrite'), done = completed(transaction);
  const usage = { events: 0, incidents:0, bytes: 0, discardedEvents: 0, discardedBodies: 0, discardedIncidents:0 };
  for (const name of ['events', 'bodies', 'incidents']) {
    await new Promise((resolve, reject) => {
      const index = transaction.objectStore(name).index('size');
      const request = index.openKeyCursor(null,'nextunique');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const count = index.count(cursor.key);
        count.onerror = () => reject(count.error);
        count.onsuccess = () => {
          usage.bytes += cursor.key * count.result;
          if (name !== 'bodies') usage[name] += count.result;
          cursor.continue();
        };
      };
    });
  }
  transaction.objectStore('meta').put(usage, 'usage');
  await done;
}

/** Export a bounded snapshot in chunks without requiring one huge runtime message. */
export async function journalExport(account, context = {}) {
  await writes;
  const db = await database();
  await serialize(() => trim(db));
  const usage = await result(db.transaction('meta').objectStore('meta').get('usage'));
  const snapshotAt = Date.now();
  const chunks = [JSON.stringify({ schema: 2, purpose: 'Portal continuous diagnostics', version: chrome.runtime.getManifest().version, account, snapshotAt, limits: JOURNAL_LIMITS, retention: usage, ...context }).slice(0, -1), ',"events":['];
  let count = 0, key;
  try { key = await vaultKey(account); } catch { /* Metadata exports remain available while locked. */ }
  for (const name of ['events', 'bodies', 'incidents']) {
    if (name !== 'events') { chunks.push(`],"${name === 'bodies' ? 'responses' : 'incidents'}":[`); count = 0; }
    let after;
    for (;;) {
      const rows = await new Promise((resolve, reject) => {
        const batch = [], request = db.transaction(name).objectStore(name).openCursor(after === undefined ? null : IDBKeyRange.lowerBound(after, true));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || batch.length >= 128) return resolve(batch);
          after = cursor.key;
          if ((!cursor.value.account || cursor.value.account === account) && (cursor.value.at || cursor.value.lastAt) <= snapshotAt) batch.push(cursor.value);
          cursor.continue();
        };
      });
      if (!rows.length) break;
      for (const row of rows) {
        const { size, sealed, ...value } = row;
        if (sealed) {
          try { value.content = key ? JSON.parse(new TextDecoder().decode(await openArchiveBytes(account, sealed, `journal:${row.key}`))) : { omitted: 'archive-locked' }; }
          catch { value.content = { omitted: 'response-cannot-be-decrypted' }; }
        }
        chunks.push((count++ ? ',' : '') + JSON.stringify(value));
      }
      if (rows.length < 128) break;
    }
  }
  chunks.push(']}');
  return new Blob(chunks, { type: 'application/json' });
}

/** Strip known credentials from structured metadata at the ingestion boundary. */
export function diagnosticFields(value, depth = 0) {
  if (depth > 8) return '[depth limit]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 16000);
  if (Array.isArray(value)) return value.slice(0, 200).map(item => diagnosticFields(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/password|passwd|token|secret|authorization|cookie|vaultKey|privateKey|captureSession/i.test(key)).map(([key, item]) => [key,
    /url$/i.test(key) && typeof item === 'string' ? safeRequestUrl(item) : diagnosticFields(item, depth + 1)]));
}
