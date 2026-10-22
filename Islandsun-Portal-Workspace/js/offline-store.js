import { sealRecord, openRecord, sealBytes, openBytes, wrapFileKey, unwrapFileKey, clearVault, captureReadAccess } from './offline-vault.js';
import { archiveRecordReadable } from './offline-access.js';

const DATABASE = 'islandsun-offline';
let opening;
const request = operation => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});
const complete = transaction => {
  const promise = new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = () => reject(transaction.error || new DOMException('Archive transaction aborted.', 'AbortError'));
  transaction.onerror = () => {};
  });
  // A failed individual request may reject before the caller awaits transaction completion.
  promise.catch(() => {});
  return promise;
};

export function openArchive() {
  if (!opening) opening = new Promise((resolve, reject) => {
    let blocked = false;
    const operation = indexedDB.open(DATABASE, 5);
    operation.onupgradeneeded = event => {
      const database = operation.result;
      if (event.oldVersion < 1) {
        const records = database.createObjectStore('records', {keyPath:'key'});
        records.createIndex('accountKind', ['account','kind']);
        records.createIndex('date', 'date');
        records.createIndex('accountDate', ['account','date']);
        const files = database.createObjectStore('files', {keyPath:'key'});
        files.createIndex('parent', 'parent');
        files.createIndex('date', 'date');
        database.createObjectStore('meta', {keyPath:'key'});
      }
      const records = operation.transaction.objectStore('records');
      if (event.oldVersion < 2) records.createIndex('detailQueue',['account','detailPriority','sortDate']);
      if (event.oldVersion < 3) {
        database.createObjectStore('blobs', {keyPath:'hash'});
        operation.transaction.objectStore('files').createIndex('hash','hash');
      }
      if (event.oldVersion < 4) records.createIndex('detailKindQueue',['account','kind','detailPriority','sortDate']);
      if (event.oldVersion < 5) {
        operation.transaction.objectStore('files').createIndex('account','account');
        operation.transaction.objectStore('blobs').createIndex('size','size');
      }
      if (event.oldVersion === 1) {
        const cursor = records.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          item.update({...item.value,...queueFields(item.value,item.value)}); item.continue();
        };
      }
    };
    operation.onerror = () => { opening = null; reject(operation.error); };
    operation.onblocked = () => { blocked = true; opening = null; reject(new Error('Close older offline tabs and reopen the archive.')); };
    operation.onsuccess = () => {
      if (blocked) { operation.result.close(); return; }
      operation.result.onversionchange = () => { operation.result.close(); opening = null; };
      resolve(operation.result);
    };
  });
  return opening;
}

function queueFields(record, previous) {
  const priority = detailChanged(record,previous) ? 0 : previous?.detailPriority ?? (previous?.detailAt ? 1 : 0);
  return {detailPriority:record.detailUrl ? priority : undefined, sortDate:record.date ? -Date.parse(`${record.date}T00:00:00Z`) : 0};
}

function detailChanged(record, previous) {
  return previous?.detailRevision && record.detailRevision ? previous.detailRevision !== record.detailRevision : previous?.fingerprint !== record.fingerprint;
}

function encryptedMetadata(record = {}) {
  const {fields,number,detail,...metadata} = record;
  return metadata;
}

export async function readArchive(store, key, options) {
  const database = await openArchive();
  const value = await request(database.transaction(store).objectStore(store).get(key));
  return store === 'records' ? openRecord(value,options) : value;
}

/** Check account and source permissions before decrypting a record for the viewer. */
export async function readVisibleRecord(key, account, kind, options) {
  const database = await openArchive();
  const value = await request(database.transaction('records').objectStore('records').get(key));
  if (!value || value.account !== account || value.kind !== kind) return null;
  if (!archiveRecordReadable(value)) throw Object.assign(new Error('Connect to the portal to check access to this older saved record.'),{code:'ARCHIVE_SCOPE_PENDING'});
  return openRecord(value,options);
}
export async function archiveMeta(key, value) {
  const database = await openArchive();
  const transaction = database.transaction('meta', 'readwrite');
  const done = complete(transaction);
  transaction.objectStore('meta').put({key, ...value});
  await done;
}

/** Evict one complete business date across categories, including each record's files. */
export async function evictOldestDate(incomingDate = '9999-12-31') {
  const database = await openArchive();
  const transaction = database.transaction(['records','files','meta','blobs'], 'readwrite');
  const done = complete(transaction);
  const records = transaction.objectStore('records');
  const first = await request(records.index('date').openCursor(IDBKeyRange.lowerBound('0001-01-01')));
  const date = first?.key;
  if (!date || date > incomingDate) { await done; return null; }
  const hashes = new Set();
  const removeGroup = store => new Promise((resolve, reject) => {
    const cursor = transaction.objectStore(store).index('date').openCursor(IDBKeyRange.only(date));
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) { resolve(); return; }
      if (store === 'files' && item.value.hash) hashes.add(item.value.hash);
      item.delete(); item.continue();
    };
  });
  await Promise.all([removeGroup('records'), removeGroup('files')]);
  await releaseBlobs(transaction, hashes);
  transaction.objectStore('meta').put({key:'retention', through:date, evictedAt:Date.now()});
  await done;
  return date;
}

export async function quotaWrite(write, date, evict = evictOldestDate) {
  for (;;) {
    try { return await write(); }
    catch (error) {
      if (error.name !== 'QuotaExceededError') throw error;
      const evicted = await evict(date || undefined);
      if (!evicted || date && evicted >= date) throw new Error('Storage is full. Older dates were removed; this item could not be saved.');
    }
  }
}

/** Merge a list refresh without discarding the independently dated detail snapshot. */
export async function saveRecord(record) {
  const retention = await readArchive('meta', 'retention');
  if (record.date && record.date <= retention?.through) return false;
  record = await sealRecord(record);
  await quotaWrite(async () => {
    const database = await openArchive();
    const transaction = database.transaction('records', 'readwrite');
    const done = complete(transaction);
    const store = transaction.objectStore('records');
    const previous = await request(store.get(record.key));
    const changed = detailChanged(record,previous);
    store.put({...encryptedMetadata(previous), ...record, ...queueFields(record,previous), nextDetailAt: changed ? 0 : previous?.nextDetailAt || 0,
      ...(changed ? {detailCapture:null,detailFailures:0} : {})});
    await done;
  }, record.date);
  return true;
}

/** Batches bound transaction work and memory, not the number of persisted records. */
export async function saveRecords(records, shouldContinue = () => true) {
  let stored = 0;
  const database = await openArchive();
  for (let offset = 0; offset < records.length; offset += 250) {
    if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
    const retention = await readArchive('meta','retention');
    const batch = await Promise.all(records.slice(offset,offset+250).filter(record => !record.date || record.date > (retention?.through || '')).map(sealRecord));
    if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
    try {
      const transaction = database.transaction('records','readwrite');
      const done = complete(transaction), store = transaction.objectStore('records');
      for (const record of batch) {
        const lookup = store.get(record.key);
        lookup.onsuccess = () => {
          const previous = lookup.result;
          const changed = detailChanged(record,previous);
          store.put({...encryptedMetadata(previous),...record,...queueFields(record,previous),nextDetailAt:changed ? 0 : previous.nextDetailAt || 0,
            ...(changed ? {detailCapture:null,detailFailures:0} : {})});
        };
      }
      await done; stored += batch.length;
    } catch (error) {
      if (error.name !== 'QuotaExceededError') throw error;
      for (const record of batch) {
        if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
        if (await saveRecord(record)) stored++;
      }
    }
    await new Promise(resolve => setTimeout(resolve,0));
  }
  return stored;
}

export async function updateDetail(key, detail, savedAt = Date.now(), {pendingFiles = false, expected, shouldContinue = () => true} = {}) {
  const existing = await readArchive('records', key,{capture:true});
  if (!existing || !shouldContinue()) return false;
  const encrypted = await sealRecord({...existing,detail});
  return quotaWrite(async () => {
    const database = await openArchive();
    const transaction = database.transaction('records', 'readwrite');
    const done = complete(transaction);
    const store = transaction.objectStore('records');
    const record = await request(store.get(key));
    const changed = record?.fingerprint !== existing.fingerprint;
    const accepted = Boolean(record && shouldContinue() && !(record.detailAt > savedAt) && (record.content || !changed)
      && (!expected || archiveRecordReadable(record) && record.fingerprint === expected.fingerprint
        && record.detailAt === expected.detailAt && record.rawDetailAt === detail.sourceCapturedAt));
    if (accepted) {
      // A concurrent list refresh owns its content and must remain queued for a matching detail.
      store.put({...encryptedMetadata(record),content:record.content || encrypted.content,fingerprint:record.content ? record.fingerprint : encrypted.fingerprint,detailContent:encrypted.detailContent,detailAt:savedAt,detailPriority:changed ? 0 : 1,nextDetailAt:changed || pendingFiles ? 0 : Number.MAX_SAFE_INTEGER,
        detailCapture:pendingFiles ? {at:savedAt,fingerprint:existing.fingerprint} : null,
        detailFailures:pendingFiles ? record.detailFailures || 0 : 0});
    }
    await done;
    return accepted;
  }, existing.date);
}

/** Complete only the captured revision whose document writes have all committed. */
export async function completeDetailCapture(snapshot) {
  const database = await openArchive();
  const transaction = database.transaction(['records','files','blobs'],'readwrite');
  const done = complete(transaction), store = transaction.objectStore('records');
  const current = await request(store.get(snapshot.key));
  const accepted = Boolean(current && archiveRecordReadable(current)
    && current.fingerprint === snapshot.fingerprint && current.detailAt === snapshot.detailAt
    && current.detailCapture?.at === snapshot.detailAt
    && current.detailCapture.fingerprint === snapshot.fingerprint);
  if (accepted) {
    const resolved = await removeFailureFile(transaction,current.key,'urn:islandsun:archive-source:failed-detail',current.detailAt);
    store.put({...current,detailCapture:null,detailFailures:0,nextDetailAt:Number.MAX_SAFE_INTEGER,
      ...(resolved ? {rawDetailFailureAt:0} : {})});
  }
  await done;
  return accepted;
}

/** Drop superseded failure bytes while retaining references owned by other records/accounts. */
async function removeFailureFile(transaction, parent, url, recoveredAt) {
  const files = transaction.objectStore('files');
  const key = JSON.stringify([parent,url]);
  const previous = await request(files.get(key));
  if (!previous || previous.savedAt > recoveredAt) return false;
  files.delete(key);
  if (previous.hash) await releaseBlobs(transaction,new Set([previous.hash]));
  return true;
}

/** Persist capped per-record backoff; a cancellation is a pause, not a failed attempt. */
export async function retryDetail(key, error, fingerprint) {
  const database = await openArchive();
  const transaction = database.transaction('records','readwrite');
  const done = complete(transaction), store = transaction.objectStore('records');
  const current = await request(store.get(key));
  let retryAt = 0;
  if (current && (fingerprint === undefined || current.fingerprint === fingerprint)) {
    const paused = error?.name === 'AbortError' || error?.code === 'SIGNED_OUT';
    const failures = paused ? current.detailFailures || 0 : Math.min(8,(current.detailFailures || 0) + 1);
    const base = error?.code === 'ARCHIVE_DATA' && !error?.status ? 300000 : 60000;
    retryAt = Date.now() + (paused ? 60000 : Math.min(3600000,base * 2 ** (failures - 1)));
    store.put({...current,detailFailures:failures,nextDetailAt:retryAt});
  }
  await done;
  return retryAt;
}

export async function postponeDetail(key, delay = 60000) {
  const database = await openArchive();
  const transaction = database.transaction('records', 'readwrite');
  const done = complete(transaction), store = transaction.objectStore('records');
  const record = await request(store.get(key));
  // Retrying a file must not promote an already-saved detail ahead of missing or changed records.
  if (record) store.put({...record, detailPriority:record.detailPriority ?? (record.detailAt ? 1 : 0), nextDetailAt:Date.now() + delay});
  await done;
}

/** Replace only a parser result; keep capture age, refresh scheduling and concurrent writes intact. */
export async function replaceParsedDetail(snapshot, detail, shouldContinue = () => true) {
  if (!shouldContinue() || !archiveRecordReadable(snapshot)) return false;
  const encrypted = await sealRecord({...snapshot,detail});
  return quotaWrite(async () => {
    const database = await openArchive();
    const transaction = database.transaction('records','readwrite');
    const done = complete(transaction), store = transaction.objectStore('records');
    const current = await request(store.get(snapshot.key));
    const accepted = Boolean(shouldContinue() && current && archiveRecordReadable(current)
      && current.account === snapshot.account && current.kind === snapshot.kind
      && current.fingerprint === snapshot.fingerprint && current.detailAt === snapshot.detailAt
      && JSON.stringify(current.detailContent) === JSON.stringify(snapshot.detailContent));
    if (accepted) store.put({...current,detailContent:encrypted.detailContent});
    await done;
    return accepted;
  },snapshot.date);
}

export async function saveFile(record, file, {shouldContinue = () => true} = {}) {
  if (!(file.blob instanceof Blob)) throw new TypeError('A saved document needs file bytes.');
  const digest = await crypto.subtle.digest('SHA-256',await file.blob.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  const rawKey = Array.from(crypto.getRandomValues(new Uint8Array(32)));
  const encrypted = await sealBytes(rawKey,await file.blob.arrayBuffer(),`file:${hash}`);
  // Public keys let a newly authorized account refresh shared bytes without knowing another user's password.
  const database = await openArchive();
  const references = await request(database.transaction('files').objectStore('files').index('hash').getAll(hash));
  const owners = [...new Set([...references.map(item => item.account),record.account])];
  const wrapped = new Map(await Promise.all(owners.map(async account => [account,await wrapFileKey(account,rawKey)])));
  return quotaWrite(async () => {
    const database = await openArchive();
    const transaction = database.transaction(['records','files','blobs'], 'readwrite');
    const done = complete(transaction);
    const parent = await request(transaction.objectStore('records').get(record.key));
    let accepted = false;
    if (shouldContinue() && parent?.account === record.account && (file.purpose !== 'source' || archiveRecordReadable(parent) && parent.fingerprint === record.fingerprint)) {
      const key = JSON.stringify([record.key,file.url]);
      const files = transaction.objectStore('files'), blobs = transaction.objectStore('blobs');
      const previous = await request(files.get(key));
      if (file.purpose === 'source' && previous?.savedAt > file.savedAt) { await done; return false; }
      blobs.put({hash,encrypted,size:file.blob.size});
      const currentReferences = await request(files.index('hash').getAll(hash));
      if (currentReferences.some(item => !wrapped.has(item.account))) {
        transaction.abort();
        throw new Error('Shared document ownership changed. Try saving the file again.');
      }
      for (const reference of currentReferences) files.put({...reference,wrappedKey:wrapped.get(reference.account)});
      const {blob,...metadata} = file;
      files.put({...metadata,hash,wrappedKey:wrapped.get(record.account),type:blob.type,key,parent:record.key,date:record.date,account:record.account});
      if (file.purpose !== 'source') await removeFailureFile(transaction,record.key,`urn:islandsun:archive-source:failed-document:${file.url}`,file.savedAt);
      if (file.purpose === 'source' && file.format === 'detail-source') transaction.objectStore('records').put({...parent,rawDetailAt:file.savedAt,rawDetailFingerprint:record.fingerprint});
      if (file.purpose === 'source' && file.format === 'failed-detail-source') transaction.objectStore('records').put({...parent,rawDetailFailureAt:file.savedAt});
      accepted = true;
      if (previous?.hash && previous.hash !== hash) await releaseBlobs(transaction,new Set([previous.hash]));
    }
    await done;
    return accepted;
  }, record.date);
}

export async function recordFiles(key, {purpose = 'documents', decrypt = true} = {}) {
  const database = await openArchive();
  const transaction = database.transaction(['files','blobs']);
  const files = (await request(transaction.objectStore('files').index('parent').getAll(key)))
    .filter(file => (file.purpose || 'documents') === purpose);
  const stored = await Promise.all(files.map(async file => ({file,shared:file.hash ? await request(transaction.objectStore('blobs').get(file.hash)) : null})));
  return Promise.all(stored.map(async ({file,shared}) => {
    if (!decrypt) return {...file,available:Boolean(shared?.encrypted && file.wrappedKey || shared?.blob?.size || file.blob?.size)};
    if (!file.hash) return file;
    if (!shared?.encrypted) return {...file,blob:shared?.blob?.slice(0,shared.blob.size,file.type)};
    const raw = await unwrapFileKey(file.account,file.wrappedKey);
    const data = await openBytes(raw,shared.encrypted,`file:${file.hash}`);
    return {...file,blob:new Blob([data],{type:file.type})};
  }));
}

/** Inspect file availability without loading or decrypting document bytes. */
export async function recordFileCoverage(key, {includeSources = false} = {}) {
  const database = await openArchive();
  const transaction = database.transaction(['files','blobs']);
  const files = await request(transaction.objectStore('files').index('parent').getAll(key));
  return Promise.all(files.filter(file => includeSources || file.purpose !== 'source').map(async file => ({
    url:file.url,
    ...(includeSources ? {purpose:file.purpose || 'documents'} : {}),
    savedAt:file.savedAt,
    available:file.hash
      ? Boolean(await request(transaction.objectStore('blobs').getKey(file.hash)))
      : Boolean(file.blob?.size),
  })));
}

/** Account-specific file references grant access; a digest alone never grants access. */
async function releaseBlobs(transaction, hashes, onProgress = () => {}) {
  let completed = 0;
  for (const hash of hashes) {
    if (!await request(transaction.objectStore('files').index('hash').count(hash))) transaction.objectStore('blobs').delete(hash);
    onProgress({phase:'shared-files',completed:++completed,total:hashes.size});
  }
}

/** Called only after background writers have stopped; shared bytes survive other owners. */
export async function clearArchive(account = null, {onProgress = () => {}} = {}) {
  const database = await openArchive();
  const transaction = database.transaction(['records','files','blobs','meta'],'readwrite');
  const done = complete(transaction);
  if (account === null) {
    let completed = 0;
    const names = ['records','files','blobs','meta'];
    const counts = await Promise.all(names.map(name => request(transaction.objectStore(name).count())));
    const total = counts.reduce((sum,count) => sum + count,0);
    onProgress({phase:'records',completed,total});
    await Promise.all(names.map(async (name,index) => {
      await request(transaction.objectStore(name).clear()); completed += counts[index];
      onProgress({phase:'records',completed,total});
    }));
  } else {
    const hashes = new Set();
    const records = transaction.objectStore('records'), files = transaction.objectStore('files'), meta = transaction.objectStore('meta');
    const range = IDBKeyRange.bound([account,''],[account,'\uffff']);
    const [recordCount,fileCount,metaKeys] = await Promise.all([
      request(records.index('accountKind').count(range)), request(files.index('account').count(account)), request(meta.getAllKeys()),
    ]);
    const ownedKeys = metaKeys.filter(key => typeof key === 'string' && (key === `account:${account}` || key === `encryption:${account}` || key.startsWith(`index:${account}:`)));
    const total = recordCount + fileCount + ownedKeys.length;
    let completed = 0;
    const advance = () => onProgress({phase:'records',completed:++completed,total});
    onProgress({phase:'records',completed,total});
    await Promise.all([
      ...ownedKeys.map(async key => { await request(meta.delete(key)); advance(); }),
      ...['records','files'].map(name => new Promise((resolve,reject) => {
      const store = transaction.objectStore(name);
      const cursor = name === 'records' ? store.index('accountKind').openKeyCursor(range) : store.index('account').openCursor(IDBKeyRange.only(account));
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) { resolve(); return; }
        if (name === 'files' && item.value.hash) hashes.add(item.value.hash);
        const removal = store.delete(item.primaryKey);
        removal.onsuccess = advance;
        item.continue();
      };
    }))]);
    onProgress({phase:'shared-files',completed:0,total:hashes.size});
    await releaseBlobs(transaction,hashes,onProgress);
  }
  await done;
  onProgress({phase:'access',completed:0,total:0});
  await clearVault(account);
}

/** Count both scopes together; the size index avoids reading encrypted file payloads. */
export async function archiveStorageUsage(account = null) {
  const database = await openArchive();
  const transaction = database.transaction(['records','files','blobs']);
  const done = complete(transaction);
  const all = {records:0,files:0,bytes:0}, current = account === null ? null : {records:0,files:0,bytes:0};
  const hashes = new Set(), currentHashes = new Set();
  const records = transaction.objectStore('records');
  await Promise.all([
    request(records.count()).then(value => { all.records = value; }),
    current && request(records.index('accountKind').count(IDBKeyRange.bound([account,''],[account,'\uffff']))).then(value => { current.records = value; }),
    new Promise((resolve,reject) => {
    const cursor = transaction.objectStore('files').openCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) { resolve(); return; }
      const file = item.value;
      if (file.purpose !== 'source') all.files++;
      if (file.hash) hashes.add(file.hash); else all.bytes += file.blob?.size || 0;
      if (current && file.account === account) {
        if (file.purpose !== 'source') current.files++;
        if (file.hash) currentHashes.add(file.hash); else current.bytes += file.blob?.size || 0;
      }
      item.continue();
    };
  })]);
  const blobs = transaction.objectStore('blobs');
  await new Promise((resolve,reject) => {
    const cursor = blobs.index('size').openKeyCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) { resolve(); return; }
      if (hashes.delete(item.primaryKey)) all.bytes += item.key;
      if (currentHashes.delete(item.primaryKey)) current.bytes += item.key;
      item.continue();
    };
  });
  // Only legacy files without a size index entry need their stored value read.
  await Promise.all([...hashes].map(async hash => {
    const value = await request(blobs.get(hash)), size = value?.size ?? value?.blob?.size ?? 0;
    all.bytes += size; if (currentHashes.has(hash)) current.bytes += size;
  }));
  await done;
  return {all,current};
}

export async function archiveUsage(account = null) {
  const usage = await archiveStorageUsage(account);
  return account === null ? usage.all : usage.current;
}

/** A complete server list revokes only this account's references to absent records. */
export async function reconcileRecords(account, kind, keys, scan = null, period = null) {
  const database = await openArchive();
  const transaction = database.transaction(['records','files','blobs'],'readwrite');
  const done = complete(transaction), records = transaction.objectStore('records'), files = transaction.objectStore('files');
  const allowed = new Set(keys || []), hashes = new Set();
  if (scan) {
    let matched = 0;
    await new Promise((resolve,reject) => {
      const cursor = records.index('accountKind').openCursor(IDBKeyRange.only([account,kind]));
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) { resolve(); return; }
        if (item.value.indexScan === scan.id) matched++;
        item.continue();
      };
    });
    // Duplicated pages or quota eviction can invalidate a scan even after its last page.
    if (matched !== scan.stored) { await done; return false; }
  }
  const removals = [];
  await new Promise((resolve,reject) => {
    const cursor = records.index('accountKind').openCursor(IDBKeyRange.only([account,kind]));
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) { resolve(); return; }
      if ((period === null || item.value.period === period) && (scan ? item.value.indexScan !== scan.id : !allowed.has(item.value.key))) {
        item.delete();
        removals.push(new Promise((removed,failed) => {
          const children = files.index('parent').openCursor(IDBKeyRange.only(item.value.key));
          children.onerror = () => failed(children.error);
          children.onsuccess = () => {
            const child = children.result;
            if (!child) { removed(); return; }
            if (child.value.hash) hashes.add(child.value.hash);
            child.delete(); child.continue();
          };
        }));
      }
      item.continue();
    };
  });
  await Promise.all(removals);
  await releaseBlobs(transaction,hashes);
  await done;
  return true;
}

export async function nextDetail(account, {kinds, afterKind, ordered = false, includeWaiting = false, capture = false} = {}) {
  const database = await openArchive();
  const readable = capture ? await captureReadAccess(account) : () => true;
  let refresh;
  if (kinds?.length) {
    const start = ordered ? 0 : Math.max(0,kinds.indexOf(afterKind) + 1);
    for (let offset = 0; offset < kinds.length; offset++) {
      const kind = kinds[(start + offset) % kinds.length];
      const record = await queuedDetail(database, 'detailKindQueue', [account,kind],includeWaiting,capture,readable);
      if (record?.captureRefresh) { refresh ||= record; continue; }
      if (record) return record;
    }
    return refresh || null;
  }
  return queuedDetail(database, 'detailQueue', [account],includeWaiting,capture,readable);
}

/** Preserve newest-first priority inside one section without decrypting skipped rows. */
function queuedDetail(database, index, prefix, includeWaiting, capture, readable) {
  return new Promise((resolve, reject) => {
    let refresh;
    const cursor = database.transaction('records').objectStore('records').index(index)
      .openCursor(IDBKeyRange.bound([...prefix,0,-Infinity],[...prefix,1,Infinity]));
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return resolve(refresh || null);
      const value = item.value;
      const captured = value.detailAt && value.detailPriority === 1 && !value.detailCapture && !value.detailFailures;
      if (!captured && archiveRecordReadable(value) && value.detailUrl && (includeWaiting || value.nextDetailAt <= Date.now())) {
        if (readable(value)) return resolve(openRecord(value,{capture}));
        refresh ||= {...value,captureRefresh:true};
      }
      item.continue();
    };
  });
}

/** Decrypt bounded cursor batches without holding another full archive copy in memory. */
export async function visitRecords(account, kind, visit, {shouldContinue = () => true, details = true, readableOnly = false, capture = false} = {}) {
  const database = await openArchive();
  const captureReadable = capture ? await captureReadAccess(account) : () => true;
  const indexKey = [account,kind];
  let after, unverified = 0;
  for (;;) {
    if (!shouldContinue()) throw new DOMException('Archive scan cancelled.','AbortError');
    const rows = await new Promise((resolve,reject) => {
      const batch = [];
      const cursor = database.transaction('records').objectStore('records').index('accountKind').openCursor(IDBKeyRange.only(indexKey));
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return resolve(batch);
        if (after !== undefined) {
          const order = indexedDB.cmp(item.primaryKey,after);
          if (order < 0) { item.continuePrimaryKey(indexKey,after); return; }
          if (order === 0) { item.continue(); return; }
        }
        batch.push(item.value);
        if (batch.length === 100) { after = item.primaryKey; resolve(batch); return; }
        item.continue();
      };
    });
    const readable = rows.filter(row => (!readableOnly || archiveRecordReadable(row)) && captureReadable(row));
    unverified += rows.length-readable.length;
    const batch = await Promise.all(readable.map(row => openRecord(row,{details,capture})));
    if (!shouldContinue()) throw new DOMException('Archive scan cancelled.','AbortError');
    for (const record of batch) {
      if (!shouldContinue()) throw new DOMException('Archive scan cancelled.','AbortError');
      await visit(record);
    }
    if (rows.length < 100) return unverified;
  }
}
/** Convert legacy plaintext before a password-protected account is announced as ready. */
export async function migrateAccount(account, shouldContinue = () => true) {
  if ((await readArchive('meta',`encryption:${account}`))?.version === 1) return;
  const database = await openArchive();
  const keys = await request(database.transaction('records').objectStore('records').index('accountKind').getAllKeys(IDBKeyRange.bound([account,''],[account,'\uffff'])));
  for (const key of keys) {
    const record = await request(database.transaction('records').objectStore('records').get(key));
    if (!record) continue;
    if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
    if (record.fields !== undefined || record.detail !== undefined || record.number !== undefined) await saveRecord(record);
    const references = await request(database.transaction('files').objectStore('files').index('parent').getAll(key));
    if (references.every(file => file.wrappedKey)) continue;
    const files = await recordFiles(record.key);
    for (const file of files) {
      if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
      if (!file.wrappedKey && file.blob) await saveFile(record,file);
    }
  }
  if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
  await archiveMeta(`encryption:${account}`,{version:1,completedAt:Date.now()});
}
