import { downloadUrl, documentParts } from './shared/document-names.js';

export function documentReadiness(root) {
  const counts = new Map();
  return [...root.querySelectorAll('[id^="addfile"]')].flatMap(container => {
    const label = container.querySelector('label')?.textContent.trim().replace(/\s+/g, ' ');
    if (!label || !documentParts(label)) return [];
    const count = counts.get(label) || 0; counts.set(label, count + 1);
    const ready = [...container.querySelectorAll('a[href]')].some(anchor => downloadUrl(anchor.getAttribute('href')));
    return [{ id: `${label}:${count}`, label, ready }];
  });
}
