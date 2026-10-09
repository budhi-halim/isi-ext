const IGNORED = '[data-isi-owned],.isi-portal-notifications,#clock,#date,script,style';

function ignored(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const dropdown = element?.closest('.select2-dropdown');
  if (dropdown) return !dropdown.querySelector('#select2-bulan-results');
  return Boolean(element?.closest(IGNORED));
}

/** Ignore the portal's clock/date heartbeat and changes entirely inside extension surfaces. */
export function needsEnhancement(records) {
  return records.some(record => {
    if (ignored(record.target)) return false;
    if (record.type === 'characterData') return true;
    if (record.type !== 'childList') return false;
    return [...record.addedNodes, ...record.removedNodes].some(node => !ignored(node));
  });
}
