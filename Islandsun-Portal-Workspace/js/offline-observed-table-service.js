import { archiveKey } from './offline-config.js';
import { readVisibleRecord } from './offline-store.js';
import { saveObservedTableSource } from './offline-source-store.js';
import { observedSampleIdentity, sameObservedSample, OBSERVED_TABLE_LIMIT } from './offline-observed-table.js';

/** Store DOM evidence separately; it does not establish ownership of session-loaded rows. */
export async function retainObservedSampleTable(message, sender, settings, canContinue) {
  const identity = observedSampleIdentity(message.url);
  if (!identity || sender.id !== chrome.runtime.id || sender.frameId !== 0
    || !sameObservedSample(sender.url, message.url) || !sameObservedSample(sender.tab?.url, message.url)
    || !settings.enabled || !settings.offlineArchive || settings.account !== message.account
    || typeof message.html !== 'string' || !message.html || message.html.length > OBSERVED_TABLE_LIMIT
    || !Number.isFinite(message.observedAt) || Math.abs(Date.now() - message.observedAt) > 60000) return false;
  const record = await readVisibleRecord(archiveKey(message.account,'sample',identity.id),message.account,'sample',{capture:true});
  if (!record || !sameObservedSample(record.detailUrl,message.url) || record.number !== message.number || !canContinue()) return false;
  return saveObservedTableSource(record, message.html, message.observedAt);
}
