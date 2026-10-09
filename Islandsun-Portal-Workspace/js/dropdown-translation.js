import { translateChrome } from './logic.js';

const LABELS = 'option,.select2-selection__rendered,.select2-selection__placeholder,.select2-results__option';

/** Translate changed dropdown chrome in the mutation microtask, before the next paint. */
export function createDropdownTranslation(journal) {
  function translate(element) {
    if (!element.isConnected || element.closest('[data-isi-owned],script,style')) return;
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const original = node.textContent;
      const translated = translateChrome(original);
      if (translated === original.trim().replace(/\s+/g, ' ')) continue;
      if (element.matches('option') && !element.hasAttribute('value')) element.setAttribute('value', element.value);
      node.textContent = original.replace(original.trim(), translated);
    }
    for (const name of ['title', 'aria-label']) {
      if (!element.hasAttribute(name)) continue;
      const original = element.getAttribute(name), translated = translateChrome(original);
      if (original !== translated) element.setAttribute(name, translated);
    }
  }
  const observer = new MutationObserver(records => {
    const labels = new Set();
    function collect(node) {
      // Text changes affect their containing label, never every descendant of the parent.
      // Catalog responses commonly include a whitespace text node between each option.
      if (node.nodeType !== Node.ELEMENT_NODE) {
        const label = node.parentElement?.closest(LABELS);
        if (label?.isConnected) labels.add(label);
        return;
      }
      const element = node;
      if (!element?.isConnected) return;
      const parentLabel = element.closest(LABELS);
      if (parentLabel) labels.add(parentLabel);
      for (const label of element.querySelectorAll(LABELS)) labels.add(label);
    }
    for (const record of records) {
      if (record.type === 'childList') {
        if (record.target.matches?.(LABELS)) labels.add(record.target);
        for (const node of record.addedNodes) collect(node);
      } else collect(record.target);
    }
    if (labels.size) journal.capture(() => { for (const label of labels) translate(label); });
  });
  observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label']});
  return { destroy() { observer.disconnect(); } };
}
