import { downloadUrl } from './shared/document-names.js';

/** Distinguish requested uploads from the portal's inactive optional upload templates. */
export function readTirDocumentState(root) {
  const counts = new Map();
  const excludedDocumentIds = [];
  const documents = [...root.querySelectorAll('[id^="addfile"]')].flatMap(container => {
    const label = container.querySelector('label')?.textContent.trim().replace(/\s+/g, ' ');
    // Custom requests such as Others need not include a catalogue name/code suffix.
    if (!label || container.querySelector('[id^="addfile"]')) return [];
    const count = counts.get(label) || 0; counts.set(label, count + 1);
    const id = `${label}:${count}`;
    const url = [...container.querySelectorAll('a[href]')].map(anchor => downloadUrl(anchor.getAttribute('href'))).find(Boolean);
    // A disabled file input alone can indicate read-only access to a real request.
    if (!url && container.hasAttribute('hidden') && container.querySelector('input[type="file"][disabled]')
      && container.querySelector('input[name^="fileirtext"][disabled]')) {
      excludedDocumentIds.push(id);
      return [];
    }
    const date = container.querySelector('time[datetime],[data-uploaded-at],[data-upload-date]');
    const rawDate = date?.getAttribute('datetime') || date?.getAttribute('data-uploaded-at') || date?.getAttribute('data-upload-date');
    const uploadedAt = rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
    return [{ id, label, ready:!!url, url:url ? String(url.href || url) : null, uploadedAt }];
  });
  return { documents, excludedDocumentIds };
}

export function documentReadiness(root) {
  return readTirDocumentState(root).documents;
}
