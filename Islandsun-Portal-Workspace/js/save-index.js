import { ACCOUNT_SCOPE } from './account-scope.js';
import { capturePortalFetch } from './debug-capture-client.js';
import { diagnosticLog } from './diagnostic-log.js';
import { logFetch, logFetchResult } from './request-log.js';
import { tirSaveIndex, sampleSaveIndex } from './save-submit-logic.js';
import { saveNeedsSignIn } from './save-response.js';
import { SAVE_RESPONSE_WAIT_MS } from './save-retry-policy.js';

/** Check the account around a foreground lookup without unlocking the offline viewer. */
export async function verifySaveAccount(account) {
  const link = document.querySelector('.user-menu a[href*="lockscreen?user="]');
  const scope = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
  if (!link || new URL(link.href).searchParams.get('user') !== account || scope && scope.account !== account) {
    throw new DOMException('The signed-in account changed. Reload the form before trying again.', 'AccountChangedError');
  }
}

/** One read-only list lookup owned by Save & Submit while optional work is held. */
export async function readSaveIndex(kind, account, signal, phase) {
  if (!['sample','tir'].includes(kind)) throw new Error('Unsupported request type.');
  const url = new URL(kind === 'tir' ? '/islandsun/master/Tir/json' : '/islandsun/samplerequest/json', location.origin).href;
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(SAVE_RESPONSE_WAIT_MS)]);
  const started = performance.now();
  let status = 0, outcome = 'complete';
  diagnosticLog('submission-index-start', {kind, phase});
  logFetch(url, `${kind}-index`, undefined, {purpose:'native', reason:'index'});
  try {
    await verifySaveAccount(account);
    requestSignal.throwIfAborted();
    const response = await capturePortalFetch(url, {
      method:'GET', credentials:'include', cache:'no-store', redirect:'manual', signal:requestSignal,
    }, `submission-${kind}-index`);
    status = response.status;
    if ([401,403].includes(status)) throw new DOMException('Sign in to the portal again.', 'SignInRequiredError');
    if (!response.ok || response.type === 'opaqueredirect' || response.url !== url) {
      throw new Error('The portal did not return the request list.');
    }
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch (error) {
      if (saveNeedsSignIn(new DOMParser().parseFromString(text,'text/html'), url)) {
        throw new DOMException('Sign in to the portal again.', 'SignInRequiredError');
      }
      throw error;
    }
    const records = (kind === 'tir' ? tirSaveIndex : sampleSaveIndex)(payload);
    await verifySaveAccount(account);
    requestSignal.throwIfAborted();
    diagnosticLog('submission-index-complete', {kind, phase, count:records.size, durationMs:performance.now()-started});
    return records;
  } catch (error) {
    outcome = requestSignal.aborted ? 'cancelled' : 'failed';
    diagnosticLog('submission-index-failed', {kind, phase, status, errorType:error.name, durationMs:performance.now()-started});
    throw error;
  } finally {
    logFetchResult(url, `${kind}-index`, {outcome, status, durationMs:performance.now()-started, purpose:'native', reason:'index'});
  }
}
