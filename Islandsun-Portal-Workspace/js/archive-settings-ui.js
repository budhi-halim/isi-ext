import { diagnosticLog } from './diagnostic-log.js';

export function initializeArchiveSettings(getAccount) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#archive-delete-dialog'), message = $('#archive-settings-message');
  let info, selection, busy = false, refreshing = false, revision = 0, owner = '';
  const controls = ['#clear-account-archive','#clear-all-archives','#refresh-storage'];
  function renderDisabled() {
    for (const selector of controls) $(selector).disabled = busy || !getAccount() || !globalThis.chrome?.storage;
    $('#refresh-storage').disabled ||= refreshing;
  }
  async function refresh() {
    if (refreshing || busy || !getAccount()) return;
    const current = ++revision;
    const account = getAccount();
    refreshing = true; renderDisabled();
    $('#archive-usage').textContent = 'Calculating saved storage… You can continue using the settings.';
    try {
      const response = await chrome.runtime.sendMessage({type:'offline-storage-info'});
      if (current !== revision || account !== getAccount()) return;
      if (!response?.ok) throw new Error('unavailable');
      info = response.value;
      const size = (info.all.bytes / 1024 / 1024).toLocaleString(undefined,{maximumFractionDigits:1});
      $('#archive-usage').textContent = `${info.all.records.toLocaleString()} records · ${info.all.files.toLocaleString()} file references · ${size} MB of document bytes across all accounts. Identical files share storage.${info.current ? ` ${info.name}: ${info.current.records.toLocaleString()} records.` : ' Sign in to manage your account’s copy.'}`;
    } catch (error) {
      if (current === revision) $('#archive-usage').textContent = 'Storage usage could not be read. Saving settings and deletion remain available.';
      diagnosticLog('archive-settings-failed',{operation:'storage-usage',errorType:error.name,message:error.message});
    }
    finally { if (current === revision) refreshing = false; renderDisabled(); }
  }
  function ask(scope) {
    if (!getAccount() || busy) return;
    selection = {scope,account:getAccount()};
    $('#archive-delete-description').textContent = scope === 'all'
      ? 'Delete every account’s saved records and documents in this browser profile? This cannot be undone offline. Your saving settings stay unchanged; enabled saving rebuilds the copy automatically.'
      : 'Delete your account’s saved copy? Other accounts keep their copies, including any shared files they use. Your saving settings stay unchanged; enabled saving rebuilds the copy automatically.';
    dialog.showModal();
  }
  $('#clear-account-archive').addEventListener('click',() => ask('account'));
  $('#clear-all-archives').addEventListener('click',() => ask('all'));
  $('#cancel-archive-delete').addEventListener('click',() => dialog.close());
  dialog.addEventListener('close',() => { selection = null; });
  $('#confirm-archive-delete').addEventListener('click',async () => {
    if (busy || !selection) return;
    const chosen = selection;
    busy = true; revision++; refreshing = false; dialog.close(); renderDisabled();
    message.textContent = 'Stopping archive activity and deleting saved copies…';
    try {
      const response = await chrome.runtime.sendMessage({type:'offline-clear',...chosen});
      if (!response?.ok) throw new Error(response?.error || 'The saved copy could not be deleted. Try again.');
      message.textContent = 'Saved copy deleted. Your saving settings are unchanged. If enabled, saving restarts automatically.';
    } catch (error) { message.textContent = error.message; diagnosticLog('archive-settings-failed',{operation:'delete',scope:chosen.scope,errorType:error.name,message:error.message}); }
    finally { busy = false; await refresh(); }
  });
  $('#advanced-settings').addEventListener('toggle',() => { if ($('#advanced-settings').open && !busy) refresh(); });
  $('#refresh-storage').addEventListener('click',refresh);
  renderDisabled();
  return { sync() {
    if (owner !== getAccount()) {
      owner = getAccount(); info = null; revision++; refreshing = false;
      if (dialog.open) dialog.close();
      if ($('#advanced-settings').open && owner && !busy) void refresh();
    }
    renderDisabled();
  } };
}
