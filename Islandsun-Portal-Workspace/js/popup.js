import { initializeUpdatePopup } from './shared/update-popup.js';
import { initializeTheme } from '../assets/family/js/theme.js';
import { diagnosticArchiveSource } from './connection-diagnostics.js';
import { SESSION_KEY } from './session-keepalive.js';
import { OFFLINE_STATUS, OFFLINE_SOURCES } from './offline-config.js';
import { readArchive } from './offline-store.js';
import { initializeArchiveSettings } from './archive-settings-ui.js';
import { readAccountSettings, requestAccountSettings, accountSettingsChanged } from './account-settings.js';
import { journalExport } from './diagnostic-journal-store.js';
import { diagnosticLog } from './diagnostic-log.js';
initializeUpdatePopup('workspace', {discoverFamily:true});
initializeTheme();
const $ = selector => document.querySelector(selector);
let account = '', revision = 0;
const pendingSettings = new Set();
const accountControls = [['#keep-session-active','keepSessionAlive'],['#offline-enabled','offlineArchive'],['#offline-documents','offlineDocuments']];
const archiveSettings = initializeArchiveSettings(() => account);

async function render() {
  const current = ++revision;
  try {
    const settings = await readAccountSettings();
    const session = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
    const offline = (await chrome.storage.local.get(OFFLINE_STATUS))[OFFLINE_STATUS] || {};
    if (current !== revision) return;
    account = settings.account;
    document.body.dataset.signedIn = String(Boolean(account));
    $('#settings-account').textContent = account ? 'Settings for ' + settings.name : '';
    $('#enabled').checked = settings.enabled;
    for (const [selector,key] of accountControls) {
      const control = $(selector);
      if (!pendingSettings.has(key)) control.checked = settings[key];
      control.disabled = !account || pendingSettings.has(key);
    }
    archiveSettings.sync();
    $('#state-title').textContent = settings.enabled ? 'Always ready' : 'Paused';
    if (!account) {
      $('#advanced-settings').open = false;
      if ($('#archive-delete-dialog').open) $('#archive-delete-dialog').close();
    }
    $('#session-status').textContent = !settings.enabled || !settings.keepSessionAlive ? 'Session checks paused.'
      : session?.state === 'signed-out' ? 'Sign in again to keep your session active.'
      : session?.state === 'checking' ? 'Checking your sign-in…'
      : session?.state === 'deferred' ? 'Waiting for the portal to finish loading.'
      : session?.state === 'retrying' ? 'Rechecking your connection shortly.'
      : session?.state === 'active' ? 'Session checked at ' + new Date(session.checkedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '.'
      : 'Checking your session shortly.';
    $('#offline-status').textContent = !settings.offlineArchive ? 'Saving paused. Your offline copy is available.'
      : offline.account && offline.account !== account ? 'The offline copy fills in while you are signed in.'
      : ({active:'Saving your offline copy.',waiting:'Saving will resume when the portal is free.',offline:'The portal is unavailable. Your offline copy is available.', 'signed-out':'Sign in to resume saving.','unlock-required':'Preparing to resume saving.',attention:offline.error || 'Saving will retry shortly.'})[offline.state] || 'Your offline copy fills in while you are signed in.';
  } catch { $('#message').textContent = 'Settings could not be loaded. Reopen the extension.'; }
}

$('#enabled').addEventListener('change', async event => {
  const control = event.currentTarget; control.disabled = true;
  try { await chrome.storage.local.set({enabled:control.checked}); }
  catch { $('#message').textContent = 'The setting could not be saved.'; }
  finally { control.disabled = false; await render(); }
});
for (const [selector,key] of accountControls) {
  $(selector).addEventListener('change',async event => {
    const control = event.currentTarget, owner = account; control.disabled = true; pendingSettings.add(key);
    try { await requestAccountSettings(owner,{[key]:control.checked}); }
    catch (error) { $('#message').textContent = error.message; }
    finally { pendingSettings.delete(key); await render(); }
  });
}
if (globalThis.chrome?.storage) chrome.storage.onChanged.addListener((changes,area) => {
  if (area === 'session' && changes[SESSION_KEY] || area === 'local' && (accountSettingsChanged(changes) || changes[OFFLINE_STATUS])) render();
});
$('#open-portal').addEventListener('click',() => {
  const url = 'http://apps.islandsunindonesia.com:81/islandsun/';
  if (globalThis.chrome?.tabs) chrome.tabs.create({url}); else window.open(url,'_blank','noopener');
});
render();

$('#download-diagnostic-log').addEventListener('click', async event => {
  const button = event.currentTarget, message = $('#diagnostics-status');
  if (button.disabled) return;
  button.disabled = true; message.textContent = 'Preparing log…';
  const owner = account;
  let url;
  try {
    const settings = await readAccountSettings();
    const saved = await chrome.storage.local.get([OFFLINE_STATUS,'islandsun.journal-error']);
    const sources = owner ? await Promise.all(Object.keys(OFFLINE_SOURCES).map(async kind => diagnosticArchiveSource(kind,await readArchive('meta',`index:${owner}:${kind}`)))) : [];
    const archive = owner && saved[OFFLINE_STATUS]?.account === owner ? saved[OFFLINE_STATUS] : undefined;
    const blob = await journalExport(owner,{settings,archive,sources,logError:saved['islandsun.journal-error']});
    if ((await readAccountSettings()).account !== owner) throw new Error('The account changed. Reopen settings.');
    url = URL.createObjectURL(blob);
    await chrome.downloads.download({url,filename:`islandsun-log-${new Date().toISOString().replaceAll(':','-')}.json`,saveAs:false});
    message.textContent = 'Log downloaded.';
  } catch (error) {
    message.textContent = 'Could not download the log. Reopen the extension and try again.';
    diagnosticLog('log-export-failed', {errorType:error.name, message:String(error.message).slice(0,500)});
  }
  finally { button.disabled = false; if (url) setTimeout(()=>URL.revokeObjectURL(url),60000); }
});
