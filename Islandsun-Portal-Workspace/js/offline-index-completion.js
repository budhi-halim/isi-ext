import { ARCHIVE_SCOPE_VERSION } from './offline-access.js';

/** Retain one successful membership check separately from the latest scan attempt. */
export function indexCompletion(previous, {reconciled,total,stored,skippedIdentifiers = 0}, now = Date.now()) {
  const lastReconciled = reconciled
    ? {at:now,total,stored,skippedIdentifiers,scopeVersion:ARCHIVE_SCOPE_VERSION}
    : previous?.lastReconciled?.scopeVersion === ARCHIVE_SCOPE_VERSION ? previous.lastReconciled : null;
  return {checkedAt:now,lastCheckReconciled:reconciled === true,...(lastReconciled ? {lastReconciled} : {})};
}
