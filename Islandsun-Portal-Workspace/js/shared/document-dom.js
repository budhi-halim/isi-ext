import { downloadUrl, documentParts } from './document-names.js';

export function availableDocuments(root) {
  const found = new Map();
  for (const anchor of root.querySelectorAll('a[href]')) {
    const url = downloadUrl(anchor.href || anchor.getAttribute('href'));
    if (!url) continue;
    const container = anchor.closest('[id^="addfile"]');
    const label = container?.querySelector('label')?.textContent?.trim();
    if (documentParts(label)) found.set(url, { url, label });
  }
  return [...found.values()];
}
