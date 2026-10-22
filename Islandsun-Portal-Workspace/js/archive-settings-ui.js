import { diagnosticLog } from './diagnostic-log.js';
import { ARCHIVE_CLEANUP, archiveCleanupText } from './archive-cleanup-progress.js';

export function initializeArchiveSettings(getAccount) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#archive-delete-dialog'), message = $('#archive-settings-message'), progress = $('#archive-delete-progress');
  let info, selection, pending = false, cleanup, refreshing = false, revision = 0, owner = '';
  const controls = ['#clear-account-archive','#clear-all-archives','#refresh-storage'];
  const busy = () => pending || cleanup?.state === 'running';
  function renderDisabled() {
    for (const selector of controls) $(selector).disabled = busy() || !getAccount() || !globalThis.chrome?.storage;
    $('#refresh-storage').disabled ||= refreshing;
  }
  function showProgress(value) {
    if (!value || cleanup && (value.at < cleanup.at || value.id === cleanup.id && value.sequence < cleanup.sequence)) return;
    const wasRunning = cleanup?.state === 'running';
    cleanup = value;
    if (value.state === 'running' && !wasRunning) {
      revision++; refreshing = false;
      if (dialog.open) dialog.close();
    }
    const relevant = value.scope === 'all' || value.account === getAccount();
    message.textContent = relevant ? archiveCleanupText(value) : value.state === 'running' ? 'Deleting another saved copy…' : '';
    progress.hidden = value.state !== 'running';
    if (value.total > 0) { progress.max = value.total; progress.value = value.completed; }
    else progress.removeAttribute('value');
    renderDisabled();
    if (wasRunning && value.state !== 'running' && !pending && $('#advanced-settings').open) void refresh();
  }
  async function loadProgress() {
    try {
      const response = await chrome.runtime.sendMessage({type:'offline-cleanup-status'});
      if (response?.ok) showProgress(response.value);
    } catch { /* The request itself reports a disconnected extension when an action is attempted. */ }
  }
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area === 'local' && changes[ARCHIVE_CLEANUP]?.newValue) showProgress(changes[ARCHIVE_CLEANUP].newValue);
  });
  async function refresh() {
    if (refreshing || busy() || !getAccount()) return;
    const current = ++revision;
    const account = getAccount();
    refreshing = true; renderDisabled();
    $('#archive-usage').textContent = 'Calculating saved storage…';
    try {
      const response = await chrome.runtime.sendMessage({type:'offline-storage-info'});
      if (current !== revision || account !== getAccount()) return;
      if (!response?.ok) throw new Error('unavailable');
      info = response.value;
      const size = (info.all.bytes / 1024 / 1024).toLocaleString(undefined,{maximumFractionDigits:1});
      $('#archive-usage').textContent = `${info.all.records.toLocaleString()} records · ${info.all.files.toLocaleString()} file references · ${size} MB of document bytes across all accounts. Identical files share storage.${info.current ? ` ${info.name}: ${info.current.records.toLocaleString()} records.` : ' Sign in to manage your account’s copy.'}`;
    } catch (error) {
      if (current === revision) $('#archive-usage').textContent = 'Storage usage could not be read. Select Refresh storage usage to try again.';
      diagnosticLog('archive-settings-failed',{operation:'storage-usage',errorType:error.name,message:error.message});
    }
    finally { if (current === revision) refreshing = false; renderDisabled(); }
  }
  function ask(scope) {
    if (!getAccount() || busy()) return;
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
    if (busy() || !selection) return;
    const chosen = selection;
    pending = true; revision++; refreshing = false; dialog.close(); renderDisabled();
    message.textContent = 'Step 1 of 4 · Finishing active saves…';
    progress.hidden = false; progress.removeAttribute('value');
    try {
      const response = await chrome.runtime.sendMessage({type:'offline-clear',...chosen});
      if (!response?.ok) throw new Error(response?.error || 'The saved copy could not be deleted. Try again.');
      message.textContent = 'Saved copy deleted. Saving settings are unchanged.';
    } catch (error) { message.textContent = error.message; diagnosticLog('archive-settings-failed',{operation:'delete',scope:chosen.scope,errorType:error.name,message:error.message}); }
    finally { pending = false; await loadProgress(); progress.hidden = !busy(); renderDisabled(); await refresh(); }
  });
  $('#advanced-settings').addEventListener('toggle',() => { if ($('#advanced-settings').open && !busy()) refresh(); });
  $('#refresh-storage').addEventListener('click',refresh);
  renderDisabled();
  void loadProgress();
  return { sync() {
    if (owner !== getAccount()) {
      owner = getAccount(); info = null; revision++; refreshing = false;
      if (dialog.open) dialog.close();
      void loadProgress();
      if ($('#advanced-settings').open && owner && !busy()) void refresh();
    }
    renderDisabled();
  } };
}
