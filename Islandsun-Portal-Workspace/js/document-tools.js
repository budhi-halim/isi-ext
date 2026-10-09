import { handlerId, tirDetailUrl } from './logic.js';
import { availableDocuments } from './shared/document-dom.js';
import { readDetail } from './portal-data.js';
import { icon } from './icons.js';
import { isTirList } from './tir-page.js';
import { createDocumentLinks } from './document-links.js';

export function createDocumentTools(notify) {
  const jobs = new Map();
  const links = createDocumentLinks(notify);
  let disposed = false;
  async function download(button, url) {
    if (disposed || jobs.has(url)) return;
    const controller = new AbortController();
    jobs.set(url, controller); button.disabled = true; button.setAttribute('aria-busy', 'true');
    try {
      const root = await readDetail(url, controller.signal, { priority: true });
      if (disposed) return;
      const documents = availableDocuments(root);
      if (!documents.length) { notify('No completed documents are available for this TIR.'); return; }
      const result = await chrome.runtime.sendMessage({ type: 'download-documents', documents });
      if (disposed) return;
      if (!result || result.error) throw new Error(result?.error || 'Downloads could not start.');
      notify(`Started ${result.started} document download${result.started === 1 ? '' : 's'}.${result.failed ? ` ${result.failed} could not start. Please try again.` : ''}`, { error: result.failed > 0 });
    } catch (error) {
      if (error.name !== 'AbortError' && !disposed) notify(error.message || 'Could not load the documents.', { error: true });
    } finally {
      jobs.delete(url); button.disabled = false; button.removeAttribute('aria-busy');
    }
  }
  function enhance() {
    links.enhance();
    if (!isTirList()) return;
    for (const row of document.querySelectorAll('#mytable tbody tr')) {
      if (row.querySelector('[data-isi-download]')) continue;
      const detail = [...row.querySelectorAll('[onclick]')].find(button => handlerId(button.getAttribute('onclick'), 'edit'));
      const url = tirDetailUrl(handlerId(detail?.getAttribute('onclick'), 'edit'));
      if (!detail || !url) continue;
      const holder = document.createElement('span'); holder.className = 'isi-portal-row-actions'; holder.dataset.isiOwned = '';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'isi-portal-button'; button.dataset.isiDownload = '';
      button.append(icon('download')); button.setAttribute('aria-label', `Download documents for ${row.cells[1]?.textContent.trim() || 'this TIR'}`);
      const hint = document.createElement('span'); hint.className = 'isi-action-hint'; hint.textContent = 'Download documents'; button.append(hint);
      button.addEventListener('click', () => download(button, url));
      holder.append(button); detail.parentElement.append(holder);
    }
  }
  return { enhance, destroy() { disposed = true; links.destroy(); for (const job of jobs.values()) job.abort(); jobs.clear(); for (const button of document.querySelectorAll('[data-isi-download]')) button.parentElement.remove(); } };
}
