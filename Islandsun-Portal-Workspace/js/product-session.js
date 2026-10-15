import { hasRequestedProducts, mergeProducts, splitIssuedProduct, splitRequestedProduct } from './product-logic.js';
import { acquireLocalLock } from './local-lock.js';

/** Session storage is accessed by the trusted worker, never exposed to page scripts. */
export function productSession(account) {
  if (!account) return null;
  async function request(type, record) {
    const result = await chrome.runtime.sendMessage({ type, account, record });
    if (!result?.ok) throw new Error('Product session cache unavailable');
    return result.value;
  }
  return {
    get: async url => (await request('product-cache-read')).find(record => record.url === url),
    lock: url => acquireLocalLock(`islandsun.portal.preview:${account}:${url}`,{timeoutMs:120000}),
    load: async () => (await request('product-cache-read')).map(record => {
      const url = new URL(record.url);
      if (!/\/samplerequest\/edit$/i.test(url.pathname) || !/^[2-5]$/.test(url.searchParams.get('srtype'))) return record;
      const products=record.value.products.map(product => product.code ? product : {
        ...product,...(product.requested ? splitRequestedProduct(product.name) : splitIssuedProduct(product.name)),
      });
      return {...record,value:{...record.value,products:mergeProducts(
        products.filter(product=>product.requested),products.filter(product=>!product.requested),
        { includeRequested: hasRequestedProducts(url.searchParams.get('srtype')) },
      )}};
    }),
    save: record => request('product-cache-write', record),
  };
}
