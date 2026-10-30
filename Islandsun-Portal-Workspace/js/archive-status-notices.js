import { OFFLINE_STATUS } from './offline-config.js';
import { readAccountSettings, accountSettingsChanged } from './account-settings.js';
import { diagnosticLog } from './diagnostic-log.js';

/** Archive progress can outlive a login; only the account scope owns session warnings. */
export function createArchiveStatusNotices(account, notices) {
  let disposed = false, revision = 0, current, announced = '';
  async function observe(status) {
    current = status;
    const sequence = ++revision;
    const action = status?.account === account && status.state === 'attention' && status.actionNeeded === 'free-storage' ? 'storage' : '';
    if (!action) {
      notices.dismiss('archive-storage-full');
      return;
    }
    try {
      const settings = await readAccountSettings();
      if (disposed || sequence !== revision) return;
      if (!settings.enabled || !settings.offlineArchive || settings.account !== account) {
        announced = ''; notices.dismiss('archive-storage-full'); return;
      }
      if (action === announced) return;
      const accepted = notices.notify('Browser storage is full. Free some space to continue saving the offline copy.', {key:'archive-storage-full',tone:'warning'});
      if (accepted !== false) announced = action;
    } catch (error) { diagnosticLog('archive-status-display-failed',{errorType:error.name,message:String(error.message).slice(0,500)}); }
  }
  const changed = (changes, area) => {
    if (area !== 'local') return;
    if (changes[OFFLINE_STATUS]) void observe(changes[OFFLINE_STATUS].newValue);
    else if (accountSettingsChanged(changes)) void observe(current);
  };
  chrome.storage.onChanged.addListener(changed);
  const initial = revision;
  chrome.storage.local.get(OFFLINE_STATUS).then(value => {
    if (!disposed && revision === initial) void observe(value[OFFLINE_STATUS]);
  }).catch(error => diagnosticLog('archive-status-display-failed',{errorType:error.name}));
  return {destroy() {disposed = true; revision++; chrome.storage.onChanged.removeListener(changed); notices.dismiss('archive-storage-full');}};
}
