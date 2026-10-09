import { listVaultAccounts, vaultKey, unlockVault } from './offline-vault.js';
import { OFFLINE_SESSION, rememberOfflineSession, resumeOfflineSession } from './offline-session.js';
import { icon } from './icons.js';

/** Open account-scoped local data without a password gate during offline debugging. */
export function createOfflineDeviceAccess({onUnlock,onLock}) {
  const $ = selector => document.querySelector(selector);
  const picker = $('#offline-account-choice');
  const error = $('#offline-login-error');
  let revision = 0, activeAccount = '', lastAccount = '', busy = false, recovering = false;
  $('#offline-device-accounts').hidden = false;
  $('#offline-credential-fields').hidden = true;
  $('#offline-username').hidden = true;
  $('label[for="offline-username"]').hidden = true;
  $('#offline-previous-password').hidden = true;
  $('#offline-access-description').textContent = 'Choose a saved account. Password sign-in is temporarily disabled while offline access is being tested.';
  const accountLabel = document.createElement('span');
  accountLabel.className = 'offline-account-label';
  accountLabel.textContent = 'Accounts';
  $('#lock-offline').replaceChildren(icon('user'),accountLabel);
  $('#lock-offline').setAttribute('aria-label','Choose saved account');

  function hideContent(checking = false) {
    activeAccount = '';
    document.body.dataset.access = checking ? 'checking' : 'locked';
    $('main').inert = true;
    $('#sections').inert = true;
    $('#offline-sign-in').hidden = checking;
    $('#offline-password').value = '';
    $('#offline-protection').textContent = '';
    onLock({preserveLocation:checking});
  }
  async function choices(current) {
    const accounts = await listVaultAccounts();
    if (current !== revision) return;
    picker.replaceChildren(...accounts.map(account => new Option(`${account.name || account.account} (${account.account})`,account.account)));
    if (accounts.some(account => account.account === lastAccount)) picker.value = lastAccount;
    $('#offline-unlock').disabled = !accounts.length;
    error.textContent = accounts.length ? '' : 'No saved accounts yet. Sign in to the live portal once to start saving your copy.';
  }
  function recovery(enabled) {
    recovering = enabled;
    $('#offline-credential-fields').hidden = !enabled;
    $('#offline-previous-password').hidden = true;
    $('#offline-login-help').textContent = 'This existing archive is encrypted and its key is no longer available. Enter the password that last unlocked it once, or sign in to the live portal with that password. Future offline visits will open without it.';
    if (enabled) $('#offline-password').focus();
  }
  async function open(identity, current) {
    if (current !== revision) return;
    await onUnlock(identity);
    if (current !== revision) return;
    activeAccount = identity.account;
    lastAccount = identity.account;
    document.body.dataset.access = 'open';
    $('#offline-sign-in').hidden = true;
    $('main').inert = false;
    $('#sections').inert = document.body.dataset.navigation !== 'open';
    $('#offline-protection').textContent = 'Local device access · password protection temporarily off';
  }
  function lock(_forget = true, checking = false) {
    const current = ++revision;
    busy = false;
    hideContent(checking);
    recovery(false);
    if (!checking) choices(current).catch(() => { if (current === revision) error.textContent = 'Saved accounts could not be read. Reopen the offline copy to try again.'; });
  }
  async function resume() {
    const current = ++revision;
    busy = true;
    hideContent(true);
    try {
      const identity = await resumeOfflineSession();
      if (current !== revision) return;
      if (identity) await open(identity,current);
      else {
        hideContent();
        recovery(false);
        await choices(current);
      }
    } catch {
      if (current === revision) {
        hideContent();
        error.textContent = 'The saved workspace could not be opened. Reopen this page to try again.';
      }
    } finally {
      if (current === revision) busy = false;
      document.body.dataset.authReady = 'true';
    }
  }
  picker.addEventListener('change',() => { recovery(false); error.textContent = ''; });
  $('#lock-offline').addEventListener('click',() => { lock(); picker.focus(); });
  $('#offline-login-form').addEventListener('submit',async event => {
    event.preventDefault();
    if (busy || !picker.value) return;
    const current = ++revision;
    const account = (await listVaultAccounts()).find(value => value.account === picker.value);
    if (!account || current !== revision) return;
    busy = true;
    $('#offline-unlock').disabled = true;
    error.textContent = '';
    try {
      const identity = recovering
        ? await unlockVault(account.username || account.account,$('#offline-password').value,true)
        : {...account,key:await vaultKey(account.account)};
      $('#offline-password').value = '';
      if (current !== revision || !await rememberOfflineSession(identity,() => current === revision)) return;
      await open(identity,current);
    } catch (failure) {
      if (current !== revision) return;
      if (failure.code === 'OFFLINE_LOCKED') recovery(true);
      else error.textContent = failure.message || 'The saved copy could not be opened.';
    } finally {
      if (current === revision) { busy = false; $('#offline-unlock').disabled = false; }
    }
  });
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area === 'session' && changes[OFFLINE_SESSION] && activeAccount && changes[OFFLINE_SESSION].newValue?.account !== activeAccount) resume();
  });
  lock(false,true);
  return {lock,resume,prepare:() => lock(false,true),canNavigate:async () => !!activeAccount && document.body.dataset.access === 'open'};
}
