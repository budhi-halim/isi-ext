import { createProductPreviewUI } from './product-preview-ui.js';
import { offlinePreviewProducts } from './offline-preview-products.js';
import { readVisibleRecord } from './offline-store.js';

export function createOfflineProductPreview({getScope,notify}) {
  const repository = {
    peek() { return null; },
    async get(key,{signal}) {
      const {account,kind} = getScope();
      const record = await readVisibleRecord(key,account,kind);
      signal.throwIfAborted();
      const current = getScope();
      if (current.account !== account || current.kind !== kind) throw new DOMException('Account or section changed.','AbortError');
      return {products:offlinePreviewProducts(record)};
    },
    destroy() {},
  };
  return createProductPreviewUI({notify,repository,resolveRecord(row) {
    const {account,kind} = getScope();
    return account && ['sample','tir'].includes(kind) && row?.closest('#rows') && row.dataset.previewKey
      ? {url:row.dataset.previewKey} : null;
  }});
}
