import { diagnosticLog } from './diagnostic-log.js';

export const ARCHIVE_CLEANUP = 'islandsun.archive-cleanup';

/** Persist bounded progress so closing the popup does not hide an active cleanup. */
export function createArchiveCleanupProgress(account, scope) {
  let value = {id:crypto.randomUUID(),account,scope,state:'running',phase:'stopping',completed:0,total:0,at:Date.now()};
  let writes = Promise.resolve(), lastWrite = 0;
  return function report(fields) {
    const now = Date.now(), changed = fields.phase !== undefined && fields.phase !== value.phase || fields.state !== undefined && fields.state !== value.state;
    value = {...value,...fields,at:now,sequence:(value.sequence || 0) + 1};
    if (!changed && now - lastWrite < 500 && value.completed !== value.total) return writes;
    lastWrite = now;
    const snapshot = {...value};
    writes = writes.then(() => chrome.storage.local.set({[ARCHIVE_CLEANUP]:snapshot})).catch(error => {
      diagnosticLog('archive-cleanup-progress-failed', {errorType:error.name});
    });
    return writes;
  };
}

export function archiveCleanupText(value) {
  if (value.state === 'complete') return 'Saved copy deleted. Saving settings are unchanged.';
  if (value.state === 'interrupted') return 'Deletion was interrupted. Select Delete copy to finish.';
  if (value.state === 'failed') return 'Deletion could not finish. Select Delete copy to try again.';
  const phases = {
    stopping:'Step 1 of 4 · Finishing active saves…',
    records:'Step 2 of 4 · Deleting saved items…',
    'shared-files':'Step 2 of 4 · Removing unused file storage…',
    access:'Step 3 of 4 · Clearing saved access…',
    history:'Step 4 of 4 · Clearing diagnostic history…',
    recount:'Step 4 of 4 · Updating remaining storage totals…',
  };
  const count = value.total > 0 ? ` ${value.completed.toLocaleString()} of ${value.total.toLocaleString()}.` : '';
  return `${phases[value.phase] || 'Deleting saved copy…'}${count}`;
}

/** A terminated worker must not leave later captures permanently blocked. */
export async function recoverArchiveCleanup() {
  const saved = await chrome.storage.local.get([ARCHIVE_CLEANUP,'islandsun.archive-reset']);
  const progress = saved[ARCHIVE_CLEANUP], reset = saved['islandsun.archive-reset'];
  const values = {};
  if (reset?.clearing) values['islandsun.archive-reset'] = {account:reset.account,at:Date.now()};
  if (progress?.state === 'running') values[ARCHIVE_CLEANUP] = {...progress,state:'interrupted',at:Date.now()};
  if (Object.keys(values).length) await chrome.storage.local.set(values);
}
