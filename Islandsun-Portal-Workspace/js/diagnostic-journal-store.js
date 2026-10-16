import { capturedText, safeRequestUrl } from './debug-capture-data.js';
import { vaultKey, sealArchiveBytes, openArchiveBytes } from './offline-vault.js';

export const JOURNAL_LIMITS = Object.freeze({ days: 7, events: 150000, bytes: 128 * 1024 * 1024 });
const DATABASE = 'islandsun-diagnostic-journal';
const encoder = new TextEncoder();
let opening, writes = Promise.resolve();
let generation = 0;
const accountGenerations = new Map();
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const completed = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = () => reject(transaction.error || new Error('Diagnostic storage transaction stopped.'));
  transaction.onerror = () => {};
});

async function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const events = request.result.createObjectStore('events', { keyPath: 'sequence', autoIncrement: true });
      events.createIndex('at', 'at');
      events.createIndex('account', 'account');
      const bodies = request.result.createObjectStore('bodies', { keyPath: 'key' });
      bodies.createIndex('lastAt', 'lastAt');
      bodies.createIndex('account', 'account');
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => {
      const value = request.result;
      value.onversionchange = () => { value.close(); opening = null; };
      resolve(value);
    };
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}

function serialize(task) {
  const operation = writes.then(task);
  writes = operation.catch(() => {});
  return operation;
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
    const transaction = db.transaction(['events', 'bodies', 'meta'], 'readwrite'), done = completed(transaction);
    const meta = transaction.objectStore('meta');
    const usage = await result(meta.get('usage')) || { events: 0, bytes: 0, discardedEvents: 0, discardedBodies: 0 };
    if (stored) {
      if (!stored.lastAt) usage.bytes += stored.size;
      transaction.objectStore('bodies').put({ ...stored, lastAt: at });
    }
    const size = encoder.encode(JSON.stringify(entry)).byteLength + 128;
    transaction.objectStore('events').add({ ...entry, size });
    usage.events++; usage.bytes += size;
    meta.put(usage, 'usage');
    await done;
    if (usage.events % 128 === 0 || usage.bytes > JOURNAL_LIMITS.bytes || usage.events > JOURNAL_LIMITS.events) await trim(db);
  });
}

async function trim(db) {
  const transaction = db.transaction(['events', 'bodies', 'meta'], 'readwrite'), done = completed(transaction);
  const meta = transaction.objectStore('meta');
  const usage = await result(meta.get('usage')) || { events: 0, bytes: 0, discardedEvents: 0, discardedBodies: 0 };
  const cutoff = Date.now() - JOURNAL_LIMITS.days * 86400000;
  for (const [name, index] of [['bodies', 'lastAt'], ['events', 'at']]) {
    await new Promise((resolve, reject) => {
      const request = transaction.objectStore(name).index(index).openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const old = cursor.value[index] < cutoff;
        const over = usage.bytes > JOURNAL_LIMITS.bytes * 0.9 || name === 'events' && usage.events > JOURNAL_LIMITS.events;
        if (!old && !over) { resolve(); return; }
        cursor.delete(); usage.bytes = Math.max(0, usage.bytes - cursor.value.size);
        if (name === 'events') { usage.events--; usage.discardedEvents++; }
        else usage.discardedBodies++;
        usage.discardedThrough = Math.max(usage.discardedThrough || 0, cursor.value[index]);
        cursor.continue();
      };
    });
  }
  meta.put(usage, 'usage');
  await done;
}

export function clearJournal(account = null) {
  if (account === null) generation++;
  else accountGenerations.set(account,(accountGenerations.get(account) || 0) + 1);
  return serialize(async () => {
    const db = await database(), transaction = db.transaction(['events', 'bodies', 'meta'], 'readwrite'), done = completed(transaction);
    for (const name of ['events', 'bodies']) {
      const store = transaction.objectStore(name);
      if (account === null) store.clear();
      else {
        const request = store.index('account').openCursor(IDBKeyRange.only(account));
        request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
      }
    }
    transaction.objectStore('meta').delete('usage');
    await done;
    await recount(db);
  });
}

async function recount(db) {
  const transaction = db.transaction(['events', 'bodies', 'meta'], 'readwrite'), done = completed(transaction);
  const usage = { events: 0, bytes: 0, discardedEvents: 0, discardedBodies: 0 };
  for (const name of ['events', 'bodies']) {
    await new Promise((resolve, reject) => {
      const request = transaction.objectStore(name).openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(); usage.bytes += cursor.value.size; if (name === 'events') usage.events++; cursor.continue(); };
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
  for (const name of ['events', 'bodies']) {
    if (name === 'bodies') { chunks.push('],"responses":['); count = 0; }
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
