import { OFFLINE_PASSWORD_REQUIRED } from './offline-access-policy.js';

const ITERATIONS = 600000;
const SESSION_KEY = 'islandsun.offline-vault-keys';
const encoder = new TextEncoder(), decoder = new TextDecoder();
const keys = new Map(), preparing = new Map();
let databasePromise, sessionWrites = Promise.resolve();
const request = operation => new Promise((resolve,reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});
const bytes = value => new Uint8Array(value);
const random = length => crypto.getRandomValues(new Uint8Array(length));
const pack = value => Array.from(new Uint8Array(value));

async function database() {
  if (!databasePromise) databasePromise = new Promise((resolve,reject) => {
    const opening = indexedDB.open('islandsun-offline-vault',2);
    opening.onupgradeneeded = () => {
      const accounts = opening.result.objectStoreNames.contains('accounts')
        ? opening.transaction.objectStore('accounts')
        : opening.result.createObjectStore('accounts',{keyPath:'account'});
      if (!OFFLINE_PASSWORD_REQUIRED) return;
      const cursor = accounts.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const {deviceKey,...entry} = row.value;
        // Preserve an unenrolled archive until a successful online login protects it.
        if (!entry.password && !entry.provisionalKey && deviceKey) entry.provisionalKey = deviceKey;
        if (entry.password) delete entry.provisionalKey;
        row.update(entry);
        row.continue();
      };
    };
    opening.onsuccess = () => {
      const database = opening.result;
      database.onversionchange = () => { database.close(); databasePromise = null; };
      resolve(database);
    };
    opening.onerror = () => { databasePromise = null; reject(opening.error); };
  });
  return databasePromise;
}
export async function vaultAccount(account) {
  return request((await database()).transaction('accounts').objectStore('accounts').get(account));
}
/** Complete key-storage migration before offering protected offline access. */
export async function prepareVault() { await database(); }
async function saveAccount(value) {
  const transaction = (await database()).transaction('accounts','readwrite');
  transaction.objectStore('accounts').put(value);
  await new Promise((resolve,reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
}
async function aes(raw) { return crypto.subtle.importKey('raw',bytes(raw),'AES-GCM',false,['encrypt','decrypt']); }
export async function sealBytes(raw, value, context) {
  const iv = random(12);
  const data = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},await aes(raw),value);
  return {iv:pack(iv),data:new Uint8Array(data)};
}
export async function openBytes(raw, envelope, context) {
  return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:encoder.encode(context)},await aes(raw),bytes(envelope.data));
}
export async function passwordMaterial(password, salt = pack(random(32))) {
  if (typeof password !== 'string' || !password.trim()) throw new Error('Enter a password.');
  const material = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const key = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:ITERATIONS},material,256);
  return {salt,key:pack(key),iterations:ITERATIONS};
}
export function seedVaultKey(account, raw) { if (raw) keys.set(account,Promise.resolve(raw)); else keys.delete(account); }
async function rememberKey(account, raw) {
  await retainDeviceKey(account, raw);
  seedVaultKey(account,raw);
  if (!globalThis.chrome?.storage?.session) return;
  const result = sessionWrites.then(async () => {
    const saved = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || {};
    await chrome.storage.session.set({[SESSION_KEY]:{...saved,[account]:raw}});
  });
  sessionWrites = result.catch(() => {});
  await result;
}
async function retainDeviceKey(account, raw) {
  if (OFFLINE_PASSWORD_REQUIRED || !raw) return;
  await navigator.locks.request(`islandsun.offline-device-key:${account}`, async () => {
    const entry = await vaultAccount(account);
    if (entry && !entry.deviceKey) await saveAccount({...entry,deviceKey:raw});
  });
}
export async function listVaultAccounts() {
  const entries = await request((await database()).transaction('accounts').objectStore('accounts').getAll());
  return entries.map(({account,name,username}) => ({account,name,username}));
}
export async function vaultKey(account) {
  if (!keys.has(account)) keys.set(account,(async () => {
    const saved = globalThis.chrome?.storage?.session ? (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] : null;
    const entry = await vaultAccount(account);
    const raw = saved?.[account] || (!OFFLINE_PASSWORD_REQUIRED && entry?.deviceKey) || entry?.provisionalKey;
    if (!raw) throw Object.assign(new Error('Unlock this account’s offline copy to resume saving.'),{code:'OFFLINE_LOCKED'});
    await retainDeviceKey(account, raw);
    return raw;
  })().catch(error => { keys.delete(account); throw error; }));
  return keys.get(account);
}

/** Provisional access is deliberately unprotected until a successful portal login is captured. */
export async function ensureVault(account, name = account) {
  if (!account) throw new Error('A verified account is required.');
  if (!preparing.has(account)) preparing.set(account,navigator.locks.request(`islandsun.offline-vault:${account}`,async () => {
    const existing = await vaultAccount(account);
    if (existing) return existing;
    const master = pack(random(32));
    const pair = await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
    const publicKey = await crypto.subtle.exportKey('jwk',pair.publicKey);
    const privateKey = await sealBytes(master,await crypto.subtle.exportKey('pkcs8',pair.privateKey),`private:${account}`);
    const entry = {account,name,username:account,publicKey,privateKey,provisionalKey:master,createdAt:Date.now()};
    await saveAccount(entry); await rememberKey(account,master); return entry;
  }).finally(() => preparing.delete(account)));
  return preparing.get(account);
}

export async function protectVault(account, username, material, {samePassword = false} = {}) {
  const entry = await ensureVault(account);
  let master;
  try { master = await vaultKey(account); }
  catch {
    // A changed password cannot decrypt an old archive without the old password/key.
    const pendingKey = `islandsun.offline-password-change:${account}`;
    await chrome.storage.session.set({[pendingKey]:{username,material,createdAt:Date.now()}});
    await saveAccount({...entry,username,pendingPasswordChange:true});
    return {needsPrevious:true};
  }
  const wrapped = await sealBytes(material.key,bytes(master),`master:${account}`);
  const {provisionalKey,...protectedEntry} = await vaultAccount(account);
  if (OFFLINE_PASSWORD_REQUIRED) delete protectedEntry.deviceKey;
  await saveAccount({...protectedEntry,username,password:{salt:material.salt,iterations:ITERATIONS,wrapped},previousPassword:samePassword ? entry.previousPassword : entry.password || entry.previousPassword,pendingPasswordChange:false});
  await chrome.storage.session.remove(`islandsun.offline-password-change:${account}`);
  return {needsPrevious:false};
}

export async function restoreCapturedKey(account, raw) {
  const entry = await vaultAccount(account);
  if (!entry?.password || !raw) return false;
  try {
    const master = pack(await openBytes(raw,entry.password.wrapped,`master:${account}`));
    await rememberKey(account,master); return true;
  } catch { return false; }
}

export async function findVault(username) {
  const entries = await request((await database()).transaction('accounts').objectStore('accounts').getAll());
  const normalized = username.trim().toLowerCase();
  const matches = entries.filter(entry => [entry.username,entry.account].some(value => value?.toLowerCase() === normalized));
  return matches.length === 1 ? matches[0] : null;
}

export async function unlockVault(username, password, previous = false) {
  if (!password?.trim() || !username?.trim()) throw new Error('Enter your username and password.');
  let entry = await findVault(username);
  if (!entry) {
    const store = await import('./offline-store.js');
    const identity = await store.readArchive('meta',`account:${username.trim()}`);
    if (identity?.account === username.trim()) {
      entry = await ensureVault(identity.account,identity.name);
      await store.migrateAccount(identity.account);
    }
  }
  if (!entry) throw new Error('The username or offline password is incorrect.');
  if (OFFLINE_PASSWORD_REQUIRED && !entry.password) throw new Error('This copy has no saved portal password yet. Sign in to the live online portal once with Portal Workspace enabled, then return here. Your saved records are kept.');
  let master = entry.provisionalKey;
  if (!master) {
    const candidates = previous ? [entry.previousPassword,entry.password].filter(Boolean) : [entry.password];
    for (const candidate of candidates) {
      try {
        const material = await passwordMaterial(password,candidate.salt);
        master = pack(await openBytes(material.key,candidate.wrapped,`master:${entry.account}`));
        break;
      } catch { /* An authenticated unwrap rejects an incorrect password without exposing key bytes. */ }
    }
    if (!master) throw new Error('The username or offline password is incorrect.');
  }
  await rememberKey(entry.account,master);
  const pendingKey = `islandsun.offline-password-change:${entry.account}`;
  const pending = (await chrome.storage.session.get(pendingKey))[pendingKey];
  if (pending && Date.now() - pending.createdAt < 86400000) {
    await protectVault(entry.account,pending.username,pending.material);
    await chrome.storage.session.remove(pendingKey);
  }
  return {account:entry.account,name:entry.name,provisional:!!entry.provisionalKey,key:master};
}

export async function sealRecord(record) {
  await ensureVault(record.account);
  const raw = await vaultKey(record.account);
  const {fields,number,detail,...metadata} = record;
  if (fields !== undefined || number !== undefined) metadata.content = await sealBytes(raw,encoder.encode(JSON.stringify({fields,number})),`record:${record.key}`);
  if (detail !== undefined) metadata.detailContent = await sealBytes(raw,encoder.encode(JSON.stringify(detail)),`detail:${record.key}`);
    for (const field of ['fingerprint','detailRevision']) if (metadata[field] && !metadata[field].startsWith('sha256:')) {
      metadata[field] = `sha256:${pack(await crypto.subtle.digest('SHA-256',encoder.encode(metadata[field]))).map(value => value.toString(16).padStart(2,'0')).join('')}`;
  }
  return metadata;
}
export async function openRecord(record, {details = true} = {}) {
  if (!record || !record.content && !record.detailContent) return record;
  const raw = await vaultKey(record.account);
  const result = {...record};
  if (record.content) Object.assign(result,JSON.parse(decoder.decode(await openBytes(raw,record.content,`record:${record.key}`))));
  if (details && record.detailContent) result.detail = JSON.parse(decoder.decode(await openBytes(raw,record.detailContent,`detail:${record.key}`)));
  return result;
}

export async function wrapFileKey(account, raw) {
  const entry = await ensureVault(account);
  const key = await crypto.subtle.importKey('jwk',entry.publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  return pack(await crypto.subtle.encrypt({name:'RSA-OAEP'},key,bytes(raw)));
}
export async function unwrapFileKey(account, wrapped) {
  const entry = await vaultAccount(account);
  const privateBytes = await openBytes(await vaultKey(account),entry.privateKey,`private:${account}`);
  const key = await crypto.subtle.importKey('pkcs8',privateBytes,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
  return pack(await crypto.subtle.decrypt({name:'RSA-OAEP'},key,bytes(wrapped)));
}

export async function clearVault(account = null) {
  const transaction = (await database()).transaction('accounts','readwrite');
  if (account === null) transaction.objectStore('accounts').clear(); else transaction.objectStore('accounts').delete(account);
  await new Promise((resolve,reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
  if (account === null) keys.clear(); else keys.delete(account);
  const saved = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || {};
  if (account !== null) delete saved[account];
  await chrome.storage.session.set({[SESSION_KEY]:account === null ? {} : saved});
}
