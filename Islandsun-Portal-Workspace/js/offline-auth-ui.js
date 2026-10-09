import { prepareVault, unlockVault } from './offline-vault.js';
import { OFFLINE_SESSION, rememberOfflineSession, resumeOfflineSession } from './offline-session.js';
import { OFFLINE_PASSWORD_REQUIRED } from './offline-access-policy.js';
import { createOfflineDeviceAccess } from './offline-device-access.js';

export function createOfflineAuthentication({onUnlock,onLock}) {
  if (!OFFLINE_PASSWORD_REQUIRED) return createOfflineDeviceAccess({onUnlock,onLock});
  const $ = selector => document.querySelector(selector);
  let previous = false, revision = 0, busy = false, activeAccount = '';
  const loginHelp = $('#offline-login-help').textContent;
  function lock(forget = true, checking = false) {
    revision++; document.body.dataset.access = checking ? 'checking' : 'locked';
    activeAccount = '';
    $('main').inert = true; $('#sections').inert = true;
    $('#offline-sign-in').hidden = checking; $('#offline-password').value = '';
    $('#offline-protection').textContent = '';
    onLock({preserveLocation:checking});
    if (forget) chrome.runtime.sendMessage({type:'offline-lock'}).then(result => {
      if (!result?.ok) throw new Error('Offline lock was not saved.');
    }).catch(() => { $('#offline-login-error').textContent = 'The saved session could not be cleared. Close the browser to lock this copy.'; });
  }
  async function open(identity, current) {
    await onUnlock(identity);
    if (current !== revision) return;
    activeAccount = identity.account;
    document.body.dataset.access = 'open'; $('#offline-sign-in').hidden = true; $('main').inert = false;
    $('#sections').inert = document.body.dataset.navigation !== 'open';
    $('#offline-protection').textContent = identity.provisional ? 'Provisional · not password-protected' : 'Encrypted copy';
    $('#title').setAttribute('tabindex','-1'); $('#title').focus({preventScroll:true});
  }
  async function resume() {
    const current = ++revision;
    busy = true; $('#offline-unlock').disabled = true;
    try {
      await prepareVault();
      const identity = await resumeOfflineSession();
      if (current === revision) {
        if (identity) await open(identity,current);
        else lock(false);
      }
    } catch { if (current === revision) { lock(false); $('#offline-login-error').textContent = 'Your saved session could not be restored. Unlock this copy to continue.'; } }
    finally { busy = false; $('#offline-unlock').disabled = false; document.body.dataset.authReady = 'true'; }
  }
  async function canNavigate() {
    const current = revision;
    if (!activeAccount || document.body.dataset.access !== 'open') return false;
    try {
      const identity = await resumeOfflineSession();
      if (current !== revision) return false;
      if (identity?.account === activeAccount) return true;
    } catch { /* A failed access check must not display another saved section. */ }
    if (current === revision) lock(false);
    return false;
  }
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area === 'session' && changes[OFFLINE_SESSION] && activeAccount && changes[OFFLINE_SESSION].newValue?.account !== activeAccount) lock(false);
  });
  $('#lock-offline').addEventListener('click',() => { lock(); $('#offline-password').focus(); });
  $('#offline-previous-password').addEventListener('click',() => {
    previous = !previous;
    $('#offline-password-label').textContent = previous ? 'Previous password' : 'Password';
    $('#offline-previous-password').textContent = previous ? 'Use current password' : 'Changed your portal password?';
    $('#offline-login-help').textContent = previous ? 'Enter the password that last opened this copy. After a successful online sign-in with your new password, the saved copy can use it too.' : loginHelp;
    $('#offline-login-error').textContent = ''; $('#offline-password').value = ''; $('#offline-password').focus();
  });
  $('#offline-login-form').addEventListener('submit',async event => {
    event.preventDefault();
    if (busy) return;
    const username = $('#offline-username').value, password = $('#offline-password').value;
    if (!username.trim() || !password.trim()) { $('#offline-login-error').textContent = 'Enter your username and a nonblank password.'; return; }
    busy = true; const current = ++revision;
    $('#offline-unlock').disabled = true; $('#offline-login-error').textContent = '';
    $('#offline-unlock').textContent = 'Opening…';
    try {
      const identity = await unlockVault(username,password,previous);
      if (current !== revision) return;
      $('#offline-password').value = '';
      if (!await rememberOfflineSession(identity,() => current === revision)) return;
      if (current !== revision) return;
      await open(identity,current);
    } catch (error) { if (current === revision) $('#offline-login-error').textContent = error.message; }
    finally { busy = false; $('#offline-unlock').disabled = false; $('#offline-unlock').textContent = 'Open saved copy'; }
  });
  lock(false,true);
  return {lock,resume,canNavigate,prepare:() => lock(false,true)};
}
