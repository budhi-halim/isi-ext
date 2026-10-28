import { portalOrigin } from './shared/portal-address.js';
import { ensureVault, findVault, passwordMaterial, protectVault, restoreCapturedKey, vaultKey } from './offline-vault.js';
import { migrateAccount } from './offline-store.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { clearOfflineSession } from './offline-session.js';
import { OFFLINE_PASSWORD_REQUIRED } from './offline-access-policy.js';

const pending = new Map();
const jobs = new Set();
let paused = false;
const candidateKey = tab => `islandsun.offline-login-candidate:${tab}`;

export function startOfflineAuthentication() {
  chrome.storage.onChanged.addListener((changes,area) => {
    if (OFFLINE_PASSWORD_REQUIRED && area === 'local' && changes[ACCOUNT_SCOPE] && changes[ACCOUNT_SCOPE].oldValue?.account !== changes[ACCOUNT_SCOPE].newValue?.account) clearOfflineSession().catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (message?.type === 'offline-lock') {
      if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/,1)[0] !== chrome.runtime.getURL('offline.html')) return;
      clearOfflineSession().then(() => respond({ok:true}),() => respond({ok:false}));
      return true;
    }
    if (message?.type !== 'offline-login-candidate' || sender.id !== chrome.runtime.id || !sender.tab?.id) return;
    try {
      const url = new URL(sender.url);
      if (!portalOrigin(url.href) || !/^\/islandsun\/login(?:\/|$)/i.test(url.pathname)) return;
    } catch { return; }
    if (typeof message.username !== 'string' || !message.username.trim() || message.username.length > 200 || typeof message.password !== 'string' || !message.password.trim() || message.password.length > 4096) return;
    const tab = sender.tab.id;
    if (pending.has(tab)) { respond({ok:false}); return; }
    const captured = Date.now();
    const username = message.username.trim();
    const operation = (async () => {
      if ((await chrome.storage.local.get({enabled:true})).enabled === false) return;
      const existing = await findVault(username);
      const material = await passwordMaterial(message.password);
      const oldMaterial = existing?.password ? await passwordMaterial(message.password,existing.password.salt) : null;
      delete message.password;
      await chrome.storage.session.set({[candidateKey(tab)]:{username,material,existingKey:oldMaterial?.key,createdAt:captured,documentId:sender.documentId,origin:portalOrigin(sender.url)}});
    })();
    pending.set(tab,operation);
    operation.then(() => respond({ok:true}),() => respond({ok:false})).finally(() => { delete message.password; pending.delete(tab); });
    return true;
  });
}

/** Only the subsequent authenticated document can enroll a submitted credential. */
export function observePortalAuthentication(message, sender) {
  if (paused) return Promise.resolve();
  const operation = authenticate(message,sender);
  jobs.add(operation);
  operation.then(() => jobs.delete(operation),() => jobs.delete(operation));
  return operation;
}

export async function pauseAuthenticationWrites(task) {
  paused = true;
  try { await Promise.allSettled([...jobs]); return await task(); }
  finally { paused = false; }
}

async function authenticate(message, sender) {
  if (!sender.tab?.id) return;
  const tab = sender.tab.id;
  await pending.get(tab)?.catch(() => {});
  const key = candidateKey(tab), candidate = (await chrome.storage.session.get(key))[key];
  const subsequentDocument = candidate && (candidate.documentId && sender.documentId ? candidate.documentId !== sender.documentId : message.observedAt > candidate.createdAt);
  if (!message.account) {
    if (subsequentDocument) await chrome.storage.session.remove(key);
    return;
  }
  if ((await chrome.storage.local.get({enabled:true})).enabled === false) return;
  await ensureVault(message.account,message.name);
  const matches = candidate && candidate.origin === portalOrigin(sender.url) && Date.now() - candidate.createdAt < 300000 && candidate.username.toLowerCase() === message.account.toLowerCase() && subsequentDocument;
  const samePassword = matches && await restoreCapturedKey(message.account,candidate.existingKey);
  let unlocked = false;
  try { await vaultKey(message.account); unlocked = true; }
  catch { /* A protected copy remains locked until its existing key is available. */ }
  if (unlocked) await migrateAccount(message.account,() => !paused);
  if (matches && !paused) {
    await protectVault(message.account,candidate.username,candidate.material,{samePassword});
    await chrome.storage.session.remove(key);
  }
}
