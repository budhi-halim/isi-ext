import { submissionIntent, submissionRecord } from './submission-logic.js';
import { requestDetailUrl, tirDetailUrl } from './logic.js';

/** Read only the native detail header, never form values or hidden workflow inputs. */
export function pageSubmissionRecord(root = document, href = location.href) {
  const page = new URL(href);
  page.pathname = page.pathname.replace(/^\/islandsun\/index\.php\//i, '/islandsun/');
  const tir = /^\/islandsun\/master\/tir\/edit\/([1-9]\d{0,11})$/i.exec(page.pathname);
  if (tir) {
    const parts = root.querySelector('.content-header .medium')?.textContent.split('|').map(text => text.trim());
    if (!parts?.[0] || !parts[1]) return null;
    const record = submissionRecord({ kind: 'tir', id: tir[1], number: parts[0], url: tirDetailUrl(tir[1]) });
    return record && { ...record, status: parts[1] };
  }
  if (!/^\/islandsun\/samplerequest\/edit$/i.test(page.pathname)) return null;
  const numberNode = [...root.querySelectorAll('.content-header > b')].find(node => /^NO SRF\s*:/i.test(node.textContent.trim()));
  if (!numberNode) return null;
  const status = numberNode.parentElement.querySelector(':scope > label.label')?.textContent.trim();
  const record = submissionRecord({ kind: 'sample', id: page.searchParams.get('id'), number: numberNode.textContent.replace(/^\s*NO SRF\s*:\s*/i, ''), url: requestDetailUrl(page.searchParams.get('id'), page.searchParams.get('srtype')) });
  return record && status ? { ...record, status } : null;
}

export function createSubmissionTracking(store, reportError) {
  let disposed = false, signature = '';
  function register(target) {
    if (disposed) return;
    const anchor = target.closest?.('a[href]');
    if (!anchor) return;
    const record = pageSubmissionRecord();
    const intent = record && submissionIntent(anchor.href, location.href, record.number);
    if (intent) {
      // Synchronous outbox persistence survives the anchor's immediate navigation.
      try { store.registerSubmission(intent); } catch (error) { reportError(error); }
    }
  }
  const click = event => {
    if (event.isTrusted && !event.defaultPrevented && event.button === 0) register(event.target);
  };
  const confirmed = event => register(event.target);
  // Bubble after inline confirmation: cancelling the native confirm sets defaultPrevented.
  window.addEventListener('click', click);
  document.addEventListener('islandsun-confirmed-link', confirmed);
  function observe() {
    if (disposed) return;
    const record = pageSubmissionRecord();
    const next = JSON.stringify(record);
    if (!record || next === signature) return;
    signature = next;
    store.observeStatuses([record], { source: 'page', observedAt: Date.now() }).catch(() => { signature = ''; });
  }
  return { observe, destroy() { disposed = true; window.removeEventListener('click', click); document.removeEventListener('islandsun-confirmed-link', confirmed); } };
}
