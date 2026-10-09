import { availableDocuments } from './shared/document-dom.js';
import { downloadUrl } from './shared/document-names.js';

/** Register native download names and route ordinary clicks through the same download service. */
export function createDocumentLinks(notify) {
  const events = new AbortController(), jobs = new Set();
  let signature = '', generation = 0;
  function enhance() {
    if (events.signal.aborted) return;
    const documents = availableDocuments(document), current = JSON.stringify(documents);
    if (current === signature || !documents.length) return;
    signature = current;
    const version = ++generation;
    chrome.runtime.sendMessage({ type: 'register-documents', documents }).then(result => {
      if (version === generation && !result?.registered) signature = '';
    }, () => { if (version === generation) signature = ''; });
  }
  document.addEventListener('click', async event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || !downloadUrl(anchor.href) || event.defaultPrevented || event.button !== 0
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const documents = availableDocuments(document).filter(item => item.url === anchor.href);
    if (!documents.length) return;
    event.preventDefault();
    if (event.detail > 1 || jobs.has(anchor.href)) return;
    const url = anchor.href;
    jobs.add(url);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'download-documents', documents });
      if (events.signal.aborted) return;
      if (!result || result.error || result.failed) notify(result?.error || 'The download could not start. Please try again.', { error: true });
    } catch {
      if (!events.signal.aborted) notify('The extension needs to be reloaded. Refresh this page and try again.', { error: true });
    } finally { jobs.delete(url); }
  }, { signal: events.signal });
  return { enhance, destroy() { generation++; events.abort(); jobs.clear(); } };
}
