import { ACCOUNT_SCOPE } from './account-scope.js';

export const ACCOUNT_SETTINGS_PREFIX = 'islandsun.account-settings:';
export const DEFAULT_ACCOUNT_SETTINGS = Object.freeze({keepSessionAlive:true, offlineArchive:true, offlineDocuments:true});
export const accountSettingsKey = account => ACCOUNT_SETTINGS_PREFIX + encodeURIComponent(account);

function preferences(value) {
  return Object.fromEntries(Object.entries(DEFAULT_ACCOUNT_SETTINGS).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
}

export async function readAccountSettings(storage = chrome.storage.local) {
  const scope = await storage.get({enabled:true, [ACCOUNT_SCOPE]:null});
  const account = scope[ACCOUNT_SCOPE]?.account || '';
  const key = accountSettingsKey(account);
  const saved = account ? (await storage.get(key))[key] : null;
  return {enabled:scope.enabled, account, name:scope[ACCOUNT_SCOPE]?.name || account, ...preferences(saved)};
}

export function accountSettingsChanged(changes) {
  return Boolean(changes.enabled || changes[ACCOUNT_SCOPE] && changes[ACCOUNT_SCOPE].oldValue?.account !== changes[ACCOUNT_SCOPE].newValue?.account
    || Object.keys(changes).some(key => key.startsWith(ACCOUNT_SETTINGS_PREFIX)));
}

let writes = Promise.resolve();
export function saveAccountSettings(account, patch, storage = chrome.storage.local) {
  const operation = writes.then(async () => {
    if (!account || !patch || Object.entries(patch).some(([key,value]) => !Object.hasOwn(DEFAULT_ACCOUNT_SETTINGS,key) || typeof value !== 'boolean')) throw new Error('The setting could not be saved.');
    const current = await readAccountSettings(storage);
    if (current.account !== account) throw new Error('The account changed. Reopen settings and try again.');
    const key = accountSettingsKey(account);
    await storage.set({[key]:{...preferences(current), ...patch}});
  });
  writes = operation.catch(() => {});
  return operation;
}

export async function requestAccountSettings(account, patch) {
  const response = await chrome.runtime.sendMessage({type:'portal-save-account-settings',account,patch});
  if (!response?.ok) throw new Error(response?.error || 'The setting could not be saved.');
}

export async function migrateAccountSettings(storage = chrome.storage.local) {
  const marker = 'islandsun.account-settings-migrated';
  const saved = await storage.get({[marker]:false,[ACCOUNT_SCOPE]:null,...DEFAULT_ACCOUNT_SETTINGS});
  if (saved[marker]) return;
  const account = saved[ACCOUNT_SCOPE]?.account;
  const patch = {[marker]:true};
  if (account) {
    const key = accountSettingsKey(account);
    if (!(await storage.get(key))[key]) patch[key] = preferences(saved);
  }
  await storage.set(patch);
  await storage.remove(Object.keys(DEFAULT_ACCOUNT_SETTINGS));
}

export function startAccountSettings() {
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (message?.type !== 'portal-save-account-settings' || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
    saveAccountSettings(message.account,message.patch).then(() => respond({ok:true}), error => respond({ok:false,error:error.message}));
    return true;
  });
  migrateAccountSettings().catch(() => {});
}
