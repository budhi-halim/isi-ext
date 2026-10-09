/** Read the unique request marker outside editable fields and product dialogs. */
export function sampleRequestNumber(root = document) {
  const numbers = [...root.querySelectorAll('.content-wrapper b,.content-wrapper strong')]
    .filter(node => !node.closest('form,.modal,dialog'))
    .map(node => /^NO SRF\s*:\s*(\d+\/[IVX]+\/\d{4}\/SRF)\s*$/i.exec(node.textContent.trim())?.[1])
    .filter(Boolean);
  const unique = [...new Set(numbers)];
  return unique.length === 1 ? unique[0] : null;
}

/** Compare saved product rows rather than the transient Add Product editor fields. */
export function sampleProductSnapshot(form) {
  const table = form.querySelector('#tableSP');
  if (!table) return undefined;
  const normalize = value => value.replace(/(\d)\s*[×x]\s*(?=\d)/gi, '$1 x ').replace(/\s+/g, ' ').trim().toLowerCase();
  const headings = [...table.querySelectorAll('thead th')].map(cell => normalize(cell.textContent));
  const columns = ['product code','sample qty','price ideal','price competitor','marketing price','description']
    .map(name => headings.findIndex(heading => heading.replace(/^produk /, 'product ') === name));
  if (columns.some(index => index < 0)) return null;
  const rows = [...table.querySelectorAll('tbody > tr')].filter(row => row.cells.length > Math.max(...columns));
  if (!rows.length) return null;
  return rows.map(row => columns.map(index => normalize(row.cells[index].textContent)));
}
