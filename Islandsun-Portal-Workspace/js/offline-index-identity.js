const NUMERIC_IDS = new Set(['sample','tir','stock','sales','delivery','returns','sudden','stock-adjustment']);

/** Validate identity without imposing one business-number format on legacy records. */
export function invalidIndexIdentity(kind, id, number) {
  if (!id || /[\u0000-\u001f\u007f]/.test(id) || NUMERIC_IDS.has(kind) && !/^[1-9]\d*$/.test(id)) return 'invalid-record-id';
  if (!number || /[\u0000-\u001f\u007f]/.test(number)) return 'missing-record-number';
  return null;
}

/** Retain a page position for pagination only; this marker must never become a saved record. */
export function omittedIndexRow(account, kind, position, reason, id, number) {
  return {key:JSON.stringify([account,kind,'omitted',position]),omitted:reason,fingerprint:JSON.stringify([id,number,reason])};
}

export function includedIndexRows(records) {
  return records.filter(record => !record.omitted);
}
