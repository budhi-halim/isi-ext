export const ARCHIVE_SCOPE_VERSION = 1;

/** Shared product prices are public; portal records need a signed-in list observation. */
export function archiveRecordReadable(record) {
  return !!record && (record.kind === 'products' || record.scopeVersion === ARCHIVE_SCOPE_VERSION);
}
