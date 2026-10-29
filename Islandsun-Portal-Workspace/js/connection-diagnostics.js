import { portalOrigin } from './shared/portal-address.js';
import { ARCHIVE_SCOPE_VERSION } from './offline-access.js';

const KINDS = new Set(['sample-index','tir-index','sample-detail','tir-detail','sample-products','tir-source','portal-read','native-table','page','session-check']);
KINDS.add('archive-identity');
KINDS.add('sales-row-lookup');
KINDS.add('archive-processing');
const ARCHIVE_KINDS = ['sample','tir','stock','sales','products','delivery','returns','sudden','availability','stock-monthly','stock-outstanding','stock-history','stock-products','stock-adjustment'];
for (const source of ARCHIVE_KINDS) {
  for (const stage of ['index','detail','document']) KINDS.add(`archive-${source}-${stage}`);
}
const OUTCOMES = new Set(['started','complete','timeout','cancelled','network-error','http-error','failed','redirect-blocked','sign-in-required','data-error']);
const ARCHIVE_STAGES = new Set(['index-processing','document-response','logo-response','sheet-parsing','account-check','source-storage','local-styles','file-validation','file-storage']);

/** Report a bounded failure category without exposing the exception message. */
export function connectionFailure(error, signal) {
  if (signal?.aborted || error.name === 'AbortError') return 'cancelled';
  if (error.name === 'TimeoutError') return 'timeout';
  if (error.code === 'SIGNED_OUT') return 'sign-in-required';
  if (error.code === 'SESSION_REDIRECT') return 'redirect-blocked';
  if (error.status) return 'http-error';
  if (error.code === 'ARCHIVE_DATA') return 'data-error';
  return error instanceof TypeError ? 'network-error' : 'failed';
}

export function sanitizeDiagnostic(value) {
  if (!value || !KINDS.has(value.kind) || !OUTCOMES.has(value.outcome)) return null;
  return {
    kind: value.kind,
    outcome: value.outcome,
    ...(ARCHIVE_STAGES.has(value.stage) ? {stage:value.stage} : {}),
    durationMs: Math.min(3600000, Math.max(0, Math.round(Number(value.durationMs) || 0))),
    status: Math.min(599, Math.max(0, Math.round(Number(value.status) || 0))),
  };
}

/** Export scan progress without saved records, account identifiers or raw errors. */
export function diagnosticArchiveSource(kind, metadata) {
  if (!ARCHIVE_KINDS.includes(kind)) return null;
  const value = metadata || {};
  const result = {kind,hasMetadata:Boolean(metadata),importing:!!value.importing,partial:!!value.partial,hasError:!!value.lastError};
  const knownIssue = new Map([
    ['The list changed during capture. Saved records are retained; another scan will follow.','list-changed'],
    ['The portal returned an incomplete or inconsistent page. The saved archive is retained.','inconsistent-page'],
    ['The portal returned an incomplete list.','incomplete-list'],
    ['The portal list format was not recognized.','unrecognized-list-format'],
    ['A record has no valid entry date. The previous saved list has been retained.','invalid-entry-date'],
    ['The archive scan changed. This page was not accepted.','scan-changed'],
    ['The signed-in account changed. This page was not archived.','account-changed'],
  ]).get(value.lastError);
  if (knownIssue) result.issue = knownIssue;
  const copyNumbers = (source, target, keys) => {
    for (const key of keys) if (Number.isSafeInteger(source[key]) && source[key] >= 0) target[key] = source[key];
  };
  copyNumbers(value,result,['checkedAt','attemptedAt','nextAttemptAt','total','stored','pendingDates','skippedIdentifiers']);
  if (typeof value.lastCheckReconciled === 'boolean') result.lastCheckReconciled = value.lastCheckReconciled;
  if (value.lastReconciled?.scopeVersion === ARCHIVE_SCOPE_VERSION && Number.isSafeInteger(value.lastReconciled.at) && value.lastReconciled.at > 0) {
    result.lastReconciled = {};
    copyNumbers(value.lastReconciled,result.lastReconciled,['at','total','stored','skippedIdentifiers','scopeVersion']);
  }
  if (value.scan) {
    result.scan = {verify:!!value.scan.verify,stable:!!value.scan.stable};
    copyNumbers(value.scan,result.scan,['scopeVersion','startedAt','headCheckedAt','cursor','stored','total','overall','pendingDates','skippedIdentifiers']);
  }
  return result;
}

export function recordConnectionDiagnostic(value) {
  try { chrome.runtime.sendMessage({type:'connection-diagnostic', value}).catch(() => {}); }
  catch { /* Diagnostics must not prevent navigation when the extension unloads. */ }
}

export function startConnectionDiagnostics({onEvent = () => {}} = {}) {
  const history = {async append(value) {
    const event=sanitizeDiagnostic(value);
    if (!event) return false;
    try { await onEvent(event); } catch { /* Logging cannot interrupt a portal request. */ }
    return true;
  }};
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'connection-diagnostic') return;
    try { if (sender.id !== chrome.runtime.id || !portalOrigin(sender.url)) return; }
    catch { return; }
    history.append(message.value).then(ok => respond({ok}), () => respond({ok:false}));
    return true;
  });
  return history;
}
