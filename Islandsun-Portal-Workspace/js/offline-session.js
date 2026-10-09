import { vaultAccount, vaultKey, listVaultAccounts } from './offline-vault.js';
import { OFFLINE_PASSWORD_REQUIRED } from './offline-access-policy.js';
import { ACCOUNT_SCOPE } from './account-scope.js';

export const OFFLINE_SESSION = 'islandsun.offline-viewer-session';
const withSession = task => navigator.locks.request(OFFLINE_SESSION,task);
const LAST_ACCOUNT = 'islandsun.offline-device-account';

/** Keep a successful local unlock for this browser session, without an idle timeout. */
export function rememberOfflineSession(identity, current = () => true) {
  return withSession(async () => {
    if (!current()) return false;
    const session = {account:identity.account};
    if (OFFLINE_PASSWORD_REQUIRED) session.authentication = 'password';
    await chrome.storage.session.set({[OFFLINE_SESSION]:session});
    if (!OFFLINE_PASSWORD_REQUIRED) await chrome.storage.local.set({[LAST_ACCOUNT]:identity.account});
    return true;
  });
}

export function clearOfflineSession(account = null) {
  return withSession(async () => {
    const saved = (await chrome.storage.session.get(OFFLINE_SESSION))[OFFLINE_SESSION];
    if (account === null || saved?.account === account) await chrome.storage.session.remove(OFFLINE_SESSION);
  });
}

/** Session metadata alone cannot unlock a protected vault whose temporary key is gone. */
export function resumeOfflineSession() {
  return withSession(async () => {
    const saved = (await chrome.storage.session.get(OFFLINE_SESSION))[OFFLINE_SESSION];
    if (OFFLINE_PASSWORD_REQUIRED && saved?.authentication !== 'password') {
      if (saved) await chrome.storage.session.remove(OFFLINE_SESSION);
      return null;
    }
    let account = saved?.account;
    if (!account && !OFFLINE_PASSWORD_REQUIRED) {
      const local = await chrome.storage.local.get([LAST_ACCOUNT,ACCOUNT_SCOPE]);
      const accounts = await listVaultAccounts();
      account = [local[LAST_ACCOUNT],local[ACCOUNT_SCOPE]?.account].find(value => accounts.some(entry => entry.account === value));
      if (!account && accounts.length === 1) account = accounts[0].account;
    }
    if (!account) return null;
    const entry = await vaultAccount(account);
    if (entry && (!OFFLINE_PASSWORD_REQUIRED || entry.password && !entry.provisionalKey)) {
      try {
        const identity = {account:entry.account,name:entry.name,provisional:!!entry.provisionalKey,key:await vaultKey(entry.account)};
        if (!OFFLINE_PASSWORD_REQUIRED) {
          await chrome.storage.session.set({[OFFLINE_SESSION]:{account:identity.account}});
          await chrome.storage.local.set({[LAST_ACCOUNT]:identity.account});
        }
        return identity;
      } catch { /* A cold or invalidated vault requires an explicit local unlock. */ }
    }
    await chrome.storage.session.remove(OFFLINE_SESSION);
    return null;
  });
}
