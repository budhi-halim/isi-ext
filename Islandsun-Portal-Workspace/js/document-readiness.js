import { downloadUrl, documentParts } from './shared/document-names.js';

export function documentReadiness(root) {
  const counts = new Map();
  return [...root.querySelectorAll('[id^="addfile"]')].flatMap(container => {
    const label = container.querySelector('label')?.textContent.trim().replace(/\s+/g, ' ');
    if (!label || !documentParts(label)) return [];
    const count = counts.get(label) || 0; counts.set(label, count + 1);
    const url = [...container.querySelectorAll('a[href]')].map(anchor => downloadUrl(anchor.getAttribute('href'))).find(Boolean);
    const date = container.querySelector('time[datetime],[data-uploaded-at],[data-upload-date]');
    const rawDate = date?.getAttribute('datetime') || date?.getAttribute('data-uploaded-at') || date?.getAttribute('data-upload-date');
    const uploadedAt = rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
    return [{ id: `${label}:${count}`, label, ready:!!url, url:url ? String(url.href || url) : null, uploadedAt }];
  });
}
