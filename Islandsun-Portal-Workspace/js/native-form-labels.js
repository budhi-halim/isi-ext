import { translateChrome } from './logic.js';

/** Translate a known form caption rendered as a table cell, without touching record values. */
export function translateNativeFormLabels(root) {
  for (const control of root.querySelectorAll('select[name="dt[so_term_of_payment]"]')) {
    const label = control.closest('td')?.previousElementSibling;
    if (!label || label.childElementCount || label.textContent.trim() !== 'Syarat Pembayaran') continue;
    label.textContent = translateChrome(label.textContent);
  }
}
