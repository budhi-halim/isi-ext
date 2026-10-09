export const DOCUMENT_RETRY_MS = 60 * 60000;

/** Keep the unavailable Delivery print service separate from record/detail refreshes. */
export function documentRetryKey(account, kind) {
  return `index:${account}:${kind}:document-retry`;
}

export function activeDocumentRetry(value, now = Date.now()) {
  if (value?.format !== 'delivery-order-sheet' || value.status !== 500
    || !Number.isFinite(value.failedAt) || value.failedAt <= 0 || !Number.isFinite(value.retryAt)
    || value.retryAt - value.failedAt !== DOCUMENT_RETRY_MS || value.retryAt <= now) return null;
  return {format:value.format,status:value.status,failedAt:value.failedAt,retryAt:value.retryAt};
}
