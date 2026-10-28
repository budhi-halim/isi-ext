import { portalOrigin } from './shared/portal-address.js';

export const OBSERVED_TABLE_LIMIT = 512 * 1024;

/** Identify the native Sample routes whose confirmation data uses session state. */
export function observedSampleIdentity(value) {
  try {
    const url = new URL(value);
    const id = url.searchParams.get('id'), sampleType = url.searchParams.get('srtype');
    if (!portalOrigin(url.href)
      || !/^\/islandsun\/(?:index\.php\/)?samplerequest\/edit\/?$/i.test(url.pathname)
      || !/^[1-9]\d*$/.test(id || '') || !['2','3','5'].includes(sampleType)) return null;
    return {id, sampleType};
  } catch { return null; }
}

export function sameObservedSample(left, right) {
  const a = observedSampleIdentity(left), b = observedSampleIdentity(right);
  return Boolean(a && b && a.id === b.id && a.sampleType === b.sampleType);
}

/** Observe only an untouched view; never infer server ownership from session-cart rows. */
export function createObservedSampleTable(account) {
  const identity = observedSampleIdentity(location.href);
  let disposed = false, timer, last = '', pending = false;
  const events = new AbortController();
  const destroy = () => { disposed = true; clearTimeout(timer); events.abort(); };
  if (identity && account) {
    for (const type of ['input','change','submit']) document.addEventListener(type, event => {
      if (event.target.closest('.content-wrapper form') && event.isTrusted) destroy();
    }, {capture:true, signal:events.signal});
    document.addEventListener('click', event => {
      if (event.target.closest('#btn-edit-lock,#btn-updated')) destroy();
    }, {capture:true, signal:events.signal});
    window.addEventListener('pagehide', destroy, {once:true, signal:events.signal});
  }
  function snapshot() {
    const body = document.querySelector('.content-wrapper #productRequest #tableSP tbody#res-cartprod');
    if (!body?.rows.length || body.closest('form')?.dataset.isiReadOnly !== 'true') return null;
    const link = document.querySelector('.user-menu a[href*="lockscreen?user="]');
    if (!link || new URL(link.href).searchParams.get('user') !== account) return null;
    const number = [...document.querySelectorAll('.content-wrapper b')]
      .map(node => node.textContent.trim().match(/^NO\s+SRF\s*:\s*(\d+\/[IVX]+\/\d{4}\/SRF)\s*$/i)?.[1]).find(Boolean);
    if (!number || body.rows.length > 1000) return null;
    const html = body.outerHTML;
    if (html.length > OBSERVED_TABLE_LIMIT) return null;
    return {number, html};
  }
  async function capture() {
    timer = undefined;
    if (disposed || pending) return;
    const value = snapshot();
    if (!value || value.html === last) return;
    pending = true;
    try {
      const response = await chrome.runtime.sendMessage({type:'offline-observed-sample-table',account,
        url:location.href,...value,observedAt:Date.now()});
      if (response?.ok) last = value.html;
    } catch { /* A disconnected extension must not affect the native page. */ }
    finally {
      pending = false;
      if (!disposed && snapshot()?.html !== value.html) {
        clearTimeout(timer); timer = setTimeout(capture, 400);
      }
    }
  }
  return {enhance() {
    if (!identity || !account || disposed) return;
    const form = document.querySelector('.content-wrapper #productRequest #tableSP')?.closest('form');
    if (form?.dataset.isiReadOnly === 'false') { destroy(); return; }
    clearTimeout(timer); timer = setTimeout(capture, 400);
  }, destroy};
}
