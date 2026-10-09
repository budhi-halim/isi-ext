import { initializeUpdatePopup } from './shared/update-popup.js';
import { initializeTheme } from '../assets/family/js/theme.js';
import { DIAGNOSTICS_KEY, DIAGNOSTIC_FAILURES_KEY, diagnosticState, diagnosticArchiveSource } from './connection-diagnostics.js';
import { SESSION_KEY } from './session-keepalive.js';
import { OFFLINE_STATUS, OFFLINE_SOURCES } from './offline-config.js';
import { readArchive } from './offline-store.js';
import { initializeArchiveSettings } from './archive-settings-ui.js';
import { readAccountSettings, requestAccountSettings, accountSettingsChanged } from './account-settings.js';
initializeUpdatePopup('workspace', {discoverFamily:true});
initializeTheme();
const $ = selector => document.querySelector(selector);
let account = '', revision = 0;
initializeArchiveSettings(() => account);

async function render() {
  const current = ++revision;
  if (!globalThis.chrome?.storage) { $('#enabled').disabled = true; $('#message').textContent = 'Preview only. Load the extension to use these settings.'; return; }
  try {
    const settings = await readAccountSettings();
    const session = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
    const offline = (await chrome.storage.local.get(OFFLINE_STATUS))[OFFLINE_STATUS] || {};
    if (current !== revision) return;
    account = settings.account;
    document.body.dataset.signedIn = String(Boolean(account));
    $('#settings-account').textContent = account ? 'Settings for ' + settings.name : '';
    $('#enabled').checked = settings.enabled;
    $('#keep-session-active').checked = settings.keepSessionAlive;
    $('#offline-enabled').checked = settings.offlineArchive;
    $('#offline-documents').checked = settings.offlineDocuments;
    $('#state-title').textContent = settings.enabled ? 'Always ready' : 'Paused';
    if (!account) {
      $('#advanced-settings').open = false;
      if ($('#archive-delete-dialog').open) $('#archive-delete-dialog').close();
    }
    $('#session-status').textContent = !settings.enabled || !settings.keepSessionAlive ? 'Session keep-alive is paused.'
      : session?.state === 'signed-out' ? 'Sign in again to keep your session active.'
      : session?.state === 'checking' ? 'Checking your sign-in…'
      : session?.state === 'deferred' ? 'Waiting for other portal activity to finish. Retrying within a minute.'
      : session?.state === 'retrying' ? 'The session check did not finish. It will retry automatically.'
      : session?.state === 'active' ? 'Session checked at ' + new Date(session.checkedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '. Checks run every five minutes while this browser is running.'
      : 'Waiting for the first session check. It should start within a minute.';
    $('#offline-status').textContent = !settings.offlineArchive ? 'Archiving paused. Your saved copy is still available.'
      : offline.account && offline.account !== account ? 'The offline copy fills in while you are signed in.'
      : ({active:'Saving records and documents for offline access.',waiting:'Archiving waits while you edit or the portal is busy.',offline:'The portal connection could not be confirmed. Your saved copy is available.', 'signed-out':'Sign in to resume saving offline records.','unlock-required':'Open the saved offline copy and unlock it to resume saving.',attention:'Archive needs attention. Open the saved copy for details.'})[offline.state] || 'The offline copy fills in while you are signed in.';
  } catch { $('#message').textContent = 'Settings could not be loaded. Reopen the extension.'; }
}

$('#enabled').addEventListener('change', async event => {
  const control = event.currentTarget; control.disabled = true;
  try { await chrome.storage.local.set({enabled:control.checked}); }
  catch { $('#message').textContent = 'The setting could not be saved.'; }
  finally { control.disabled = false; await render(); }
});
for (const [selector,key] of [['#keep-session-active','keepSessionAlive'],['#offline-enabled','offlineArchive']]) {
  $(selector).addEventListener('change',async event => {
    const control = event.currentTarget, owner = account; control.disabled = true;
    try { await requestAccountSettings(owner,{[key]:control.checked}); }
    catch (error) { $('#message').textContent = error.message; }
    finally { control.disabled = false; await render(); }
  });
}
if (globalThis.chrome?.storage) chrome.storage.onChanged.addListener((changes,area) => {
  if (area === 'session' && changes[SESSION_KEY] || area === 'local' && (accountSettingsChanged(changes) || changes[OFFLINE_STATUS])) render();
});
$('#open-portal').addEventListener('click',() => {
  const url = 'http://apps.islandsunindonesia.com:81/islandsun/';
  if (globalThis.chrome?.tabs) chrome.tabs.create({url}); else window.open(url,'_blank','noopener');
});
$('#copy-diagnostics').addEventListener('click',async event => {
  const button = event.currentTarget, message = $('#diagnostics-status');
  if (button.disabled || !account) return;
  button.disabled = true;
  const owner = account;
  try {
    const [saved, session, settings] = await Promise.all([
      chrome.storage.local.get([DIAGNOSTICS_KEY,DIAGNOSTIC_FAILURES_KEY,OFFLINE_STATUS,'enabled']),
      chrome.storage.session.get(SESSION_KEY), readAccountSettings(),
    ]);
    const sources = await Promise.all(Object.keys(OFFLINE_SOURCES).map(async kind => diagnosticArchiveSource(kind,await readArchive('meta',`index:${owner}:${kind}`))));
    if (!owner || settings.account !== owner || (await readAccountSettings()).account !== owner) throw new Error('Account changed.');
    await navigator.clipboard.writeText(JSON.stringify({version:chrome.runtime.getManifest().version,enabled:saved.enabled !== false,
      ...diagnosticState(settings,session[SESSION_KEY],saved[OFFLINE_STATUS]),
      sources,
      events:saved[DIAGNOSTICS_KEY] || [],failures:saved[DIAGNOSTIC_FAILURES_KEY] || []},null,2));
    message.textContent = 'Diagnostics copied.';
  } catch { message.textContent = 'Could not copy diagnostics. Please try again.'; }
  finally { button.disabled = false; }
});
render();
