/** Read the unique request marker outside editable fields and product dialogs. */
export function sampleRequestNumber(root = document) {
  const numbers = [...root.querySelectorAll('.content-wrapper b,.content-wrapper strong')]
    .filter(node => !node.closest('form,.modal,dialog'))
    .map(node => /^NO SRF\s*:\s*(\d+\/[IVX]+\/\d{4}\/SRF)\s*$/i.exec(node.textContent.trim())?.[1])
    .filter(Boolean);
  const unique = [...new Set(numbers)];
  return unique.length === 1 ? unique[0] : null;
}

