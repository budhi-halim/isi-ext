import { vaultKey, sealBytes, openBytes } from './offline-vault.js';
import { CAPTURE_LIMITS } from './debug-capture-data.js';

const LOCK = 'islandsun-debug-capture';
const encoder = new TextEncoder(), decoder = new TextDecoder();
let opening;
const request = operation => new Promise((resolve,reject) => { operation.onsuccess=()=>resolve(operation.result); operation.onerror=()=>reject(operation.error); });

async function database() {
  if (!opening) opening = new Promise((resolve,reject) => {
    const operation = indexedDB.open('islandsun-debug-capture',1);
    operation.onupgradeneeded = () => {
      operation.result.createObjectStore('sessions',{keyPath:'account'});
      operation.result.createObjectStore('events',{keyPath:['session','sequence']}).createIndex('session','session');
    };
    operation.onsuccess=()=>resolve(operation.result);
    operation.onerror=()=>{ opening=null; reject(operation.error); };
  });
  return opening;
}
async function transaction(stores,write) {
  const tx = (await database()).transaction(stores,'readwrite');
  const done = new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});
  write(tx); await done;
}
export async function captureStatus(account) {
  if (!account) return null;
  await vaultKey(account);
  const value = await request((await database()).transaction('sessions').objectStore('sessions').get(account));
  if (!value) return null;
  return {...value,active:value.active && Date.now()<value.expiresAt};
}
export async function clearCapture(account) {
  await vaultKey(account);
  return purgeCaptures(account);
}
/** Delete diagnostic bytes alongside an explicitly requested offline-storage cleanup. */
export function purgeCaptures(account=null) {
  return navigator.locks.request(LOCK,async()=>{
    const old = account ? await request((await database()).transaction('sessions').objectStore('sessions').get(account)) : null;
    await transaction(['sessions','events'],tx=>{
      if(account===null){tx.objectStore('sessions').clear();tx.objectStore('events').clear();return;}
      tx.objectStore('sessions').delete(account);
      if (old) tx.objectStore('events').index('session').openCursor(IDBKeyRange.only(old.id)).onsuccess=event=>{
        const cursor=event.target.result; if(cursor){cursor.delete();cursor.continue();}
      };
    });
  });
}
export async function beginCapture(account,version) {
  return navigator.locks.request(LOCK,async()=>{
    await vaultKey(account);
    if (await captureStatus(account)) throw new Error('Export or delete the previous capture before starting another.');
    const value={account,id:crypto.randomUUID(),version,startedAt:Date.now(),expiresAt:Date.now()+CAPTURE_LIMITS.durationMs,active:true,count:0,bytes:0,failures:0};
    await transaction(['sessions'],tx=>tx.objectStore('sessions').put(value));
    return value;
  });
}
export function stopCapture(account,reason='stopped') {
  return navigator.locks.request(LOCK,async()=>{
    const value=await captureStatus(account); if(!value)return;
    await transaction(['sessions'],tx=>tx.objectStore('sessions').put({...value,active:false,endedAt:value.endedAt || Date.now(),reason:value.active?reason:value.reason || 'time-limit'}));
  });
}
/** Serialize encrypted appends across worker and viewer; never evict archive records for diagnostics. */
export function appendCapture(account,id,event) {
  return navigator.locks.request(LOCK,async()=>{
    const value=await captureStatus(account);
    if(!value?.active || value.id!==id)return false;
    const plain=encoder.encode(JSON.stringify(event));
    if(value.count>=CAPTURE_LIMITS.events || value.bytes+plain.length>CAPTURE_LIMITS.bytes){
      await transaction(['sessions'],tx=>tx.objectStore('sessions').put({...value,active:false,endedAt:Date.now(),reason:'capture-limit'})); return false;
    }
    const sequence=value.count+1;
    const encrypted=await sealBytes(await vaultKey(account),plain,`debug:${id}:${sequence}`);
    await transaction(['sessions','events'],tx=>{
      tx.objectStore('events').put({session:id,sequence,encrypted});
      tx.objectStore('sessions').put({...value,count:sequence,bytes:value.bytes+plain.length,failures:value.failures+(event.failure?1:0),lastAt:event.at,lastEvent:event.event});
    });
    return true;
  });
}
export async function exportCapture(account) {
  await stopCapture(account,'exported');
  return navigator.locks.request(LOCK,async()=>{
    const session=await captureStatus(account); if(!session)throw new Error('No diagnostic capture is available.');
    const key=await vaultKey(account);
    const values=await request((await database()).transaction('events').objectStore('events').index('session').getAll(IDBKeyRange.only(session.id)));
    const events=[];
    for(const value of values)events.push(JSON.parse(decoder.decode(await openBytes(key,value.encrypted,`debug:${session.id}:${value.sequence}`))));
    return {schema:1,purpose:'Portal archive diagnostics',session,limits:CAPTURE_LIMITS,scope:'Archive, preview and session-check HTTP responses; processing, shared queue, portal navigation state and native-table metadata. Native page/table bodies, submissions and Revenue Extractor traffic are not captured.',note:'Bodies are source responses, not executable pages. Known secret fields are redacted; authentication pages omitted. Truncated bodies are not complete parser fixtures. Contains private business data. No requests are replayed by exporting.',events};
  });
}

/** Associate an export with Chrome's durable download result before removing diagnostic bytes. */
export function trackCaptureDownload(account, id, downloadId) {
  return navigator.locks.request(LOCK,async () => {
    const value = await request((await database()).transaction('sessions').objectStore('sessions').get(account));
    if (!value || value.id !== id || value.active) return;
    await transaction(['sessions'],tx => tx.objectStore('sessions').put({...value,downloadId}));
  });
}

export function cleanDownloadedCaptures() {
  return navigator.locks.request(LOCK,async () => {
    const sessions = await request((await database()).transaction('sessions').objectStore('sessions').getAll());
    for (const session of sessions) {
      if (!Number.isInteger(session.downloadId) || session.active) continue;
      const [download] = await chrome.downloads.search({id:session.downloadId});
      if (download?.state !== 'complete') continue;
      await transaction(['sessions','events'],tx => {
        tx.objectStore('sessions').delete(session.account);
        tx.objectStore('events').index('session').openCursor(IDBKeyRange.only(session.id)).onsuccess = event => {
          const cursor = event.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
      });
    }
  });
}

/** Recheck after worker/browser restart in case an export finished while no viewer was open. */
export function startCaptureCleanup() {
  const clean = () => cleanDownloadedCaptures().catch(() => {});
  chrome.downloads.onChanged.addListener(change => { if (change.state?.current === 'complete') clean(); });
  chrome.runtime.onStartup.addListener(clean);
  clean();
}
