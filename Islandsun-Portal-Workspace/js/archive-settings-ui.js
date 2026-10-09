import { ACCOUNT_SCOPE } from './account-scope.js';
import { requestAccountSettings } from './account-settings.js';

export function initializeArchiveSettings(getAccount) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#archive-delete-dialog'), message = $('#archive-settings-message');
  let info, selection, busy = false, revision = 0;
  const controls = ['#clear-account-archive','#clear-all-archives','#refresh-storage','#offline-enabled','#offline-documents'];
  function renderDisabled() {
    for (const selector of controls) $(selector).disabled = busy || !getAccount() || !globalThis.chrome?.storage;
    $('#clear-account-archive').disabled ||= !info?.account;
  }
  async function refresh() {
    const current = ++revision;
    try {
      const response = await chrome.runtime.sendMessage({type:'offline-storage-info'});
      if (current !== revision) return;
      if (!response?.ok) throw new Error('unavailable');
      info = response.value;
      const size = (info.all.bytes / 1024 / 1024).toLocaleString(undefined,{maximumFractionDigits:1});
      $('#archive-usage').textContent = `${info.all.records.toLocaleString()} records · ${info.all.files.toLocaleString()} file references · ${size} MB of document bytes across all accounts. Identical files share storage.${info.current ? ` ${info.name}: ${info.current.records.toLocaleString()} records.` : ' Sign in to manage your account’s copy.'}`;
    } catch { $('#archive-usage').textContent = 'Storage usage could not be read. Try again.'; }
    finally { renderDisabled(); }
  }
  function ask(scope) {
    if (!getAccount() || busy || scope === 'account' && !info?.account) return;
    selection = {scope,account:info?.account};
    $('#archive-delete-description').textContent = scope === 'all'
      ? 'Delete every account’s saved records and documents in this browser profile? This cannot be undone offline. Saving will pause until you turn it back on.'
      : `Delete the saved copy for ${info.name || info.account}? Other accounts keep their copies, including any shared files they use. Saving will pause until you turn it back on.`;
    dialog.showModal();
  }
  $('#clear-account-archive').addEventListener('click',() => ask('account'));
  $('#clear-all-archives').addEventListener('click',() => ask('all'));
  $('#cancel-archive-delete').addEventListener('click',() => dialog.close());
  dialog.addEventListener('close',() => { selection = null; });
  $('#confirm-archive-delete').addEventListener('click',async () => {
    if (busy || !selection) return;
    const chosen = selection;
    busy = true; dialog.close(); renderDisabled();
    message.textContent = 'Stopping archive activity and deleting saved copies…';
    try {
      const response = await chrome.runtime.sendMessage({type:'offline-clear',...chosen});
      if (!response?.ok) throw new Error(response?.error || 'The saved copy could not be deleted. Try again.');
      message.textContent = 'Saved copy deleted. Offline saving is paused.';
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; await refresh(); }
  });
  $('#advanced-settings').addEventListener('toggle',() => { if ($('#advanced-settings').open && !busy) refresh(); });
  $('#refresh-storage').addEventListener('click',refresh);
  $('#offline-documents').addEventListener('change',async event => {
    const control = event.currentTarget;
    control.disabled = true;
    try { await requestAccountSettings(getAccount(),{offlineDocuments:control.checked}); }
    catch { control.checked = !control.checked; message.textContent = 'The document setting could not be saved.'; }
    finally { renderDisabled(); }
  });
  if (globalThis.chrome?.storage) {
    chrome.storage.onChanged.addListener((changes,area) => {
      if (area !== 'local') return;
      if (changes[ACCOUNT_SCOPE] && changes[ACCOUNT_SCOPE].oldValue?.account !== changes[ACCOUNT_SCOPE].newValue?.account) {
        info = null; revision++; if (dialog.open) dialog.close(); renderDisabled();
        if ($('#advanced-settings').open && getAccount()) refresh();
      }
    });
  }
  renderDisabled();
}
