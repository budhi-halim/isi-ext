import { archiveMeta, readArchive, openArchive } from './offline-store.js';
import { sealArchiveBytes, openArchiveBytes } from './offline-vault.js';
import { capturedText } from './debug-capture-data.js';
import { PAGED_SOURCES } from './offline-pagination.js';

const context = (account,kind) => `index:${account}:${kind}:source`;
export const indexSourceKey = (account,kind,failed = false) => `${context(account,kind)}:${failed ? 'failed' : 'latest'}`;

/** Retain one latest response and one processing failure per account/source, encrypted at rest. */
export async function saveIndexSource({account,kind,text,request,scan,capturedAt = Date.now()},signal) {
  if (!account || !Object.hasOwn(PAGED_SOURCES,kind)) throw new TypeError('Unknown archive list source.');
  signal?.throwIfAborted();
  const captured = capturedText(text);
  if (captured.omitted) return null;
  const source = {schema:1,account,kind,capturedAt,url:request.url,method:request.options.method,
    requestBody:request.options.body,cursor:scan.cursor,verify:!!scan.verify,
    text:captured.text,redactions:captured.redactions};
  const compressed = await new Response(new Blob([JSON.stringify(source)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const encrypted = await sealArchiveBytes(account,compressed,context(account,kind));
  signal?.throwIfAborted();
  const requestBytes = new TextEncoder().encode(JSON.stringify([request.url,request.options.method,request.options.body]));
  const requestKey = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',requestBytes)),byte => byte.toString(16).padStart(2,'0')).join('');
  const entry = {account,kind,capturedAt,encrypted,requestKey};
  await archiveMeta(indexSourceKey(account,kind),entry);
  return entry;
}

/** A successful retry resolves only its own failed request, unless the whole scan was verified. */
export async function resolveIndexFailure(entry, complete = false) {
  if (!entry) return;
  const database = await openArchive();
  await new Promise((resolve,reject) => {
    const transaction = database.transaction('meta','readwrite'), store = transaction.objectStore('meta');
    const key = indexSourceKey(entry.account,entry.kind,true);
    const reading = store.get(key);
    reading.onsuccess = () => {
      const failed = reading.result;
      if (failed && failed.capturedAt <= entry.capturedAt && (complete || failed.requestKey && failed.requestKey === entry.requestKey)) store.delete(key);
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function retainFailedIndexSource(entry,signal) {
  signal?.throwIfAborted();
  if (entry) await archiveMeta(indexSourceKey(entry.account,entry.kind,true),entry);
}

export async function readIndexSource(account,kind,failed = false) {
  const entry = await readArchive('meta',indexSourceKey(account,kind,failed));
  if (!entry || entry.account !== account || entry.kind !== kind) return null;
  const compressed = await openArchiveBytes(account,entry.encrypted,context(account,kind));
  const text = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const source = JSON.parse(text);
  return source.account === account && source.kind === kind ? source : null;
}
