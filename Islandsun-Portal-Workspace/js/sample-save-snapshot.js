/** Read the unique request marker outside editable fields and product dialogs. */
export function sampleRequestNumber(root = document) {
  const numbers = [...root.querySelectorAll('.content-wrapper b,.content-wrapper strong')]
    .filter(node => !node.closest('form,.modal,dialog'))
    .map(node => /^NO SRF\s*:\s*(\d+\/[IVX]+\/\d{4}\/SRF)\s*$/i.exec(node.textContent.trim())?.[1])
    .filter(Boolean);
  const unique = [...new Set(numbers)];
  return unique.length === 1 ? unique[0] : null;
}

const PRODUCT_COLUMNS = ['product code','sample qty','price ideal','price competitor','marketing price','description'];
const normalize = value => String(value).replace(/(\d)\s*[×x]\s*(?=\d)/gi, '$1 x ').replace(/\s+/g, ' ').trim().toLowerCase();
const heading = value => normalize(value).replace(/^produk /, 'product ').replace(/^desription$/, 'description');

/** The visible form is translated, whereas the verification iframe retains native headings. */
export function sampleProductSnapshot(form) {
  const table = form.matches?.('table') ? form : form.querySelector('#tableSP');
  if (!table) return undefined;
  const headings = [...table.querySelectorAll('thead th')].map(cell => heading(cell.textContent));
  const columns = PRODUCT_COLUMNS.map(name => headings.indexOf(name));
  if (columns.some(index => index < 0)) return null;
  const rows = [...table.querySelectorAll('tbody > tr')].filter(row => row.cells.length > Math.max(...columns));
  if (!rows.length) return null;
  return rows.map(row => columns.map((index,column) => {
    const value = normalize(row.cells[index].textContent);
    // The saved form can omit insignificant decimal zeros in price columns.
    return column >= 2 && column <= 4 && /^\d+(?:\.\d+)?$/.test(value) ? String(Number(value)) : value;
  }));
}

export function sameSampleProducts(expected, actual) {
  if (!expected) return expected === actual;
  if (!actual || expected.length !== actual.length) return false;
  const sorted = rows => rows.map(row => JSON.stringify(row)).sort();
  return JSON.stringify(sorted(expected)) === JSON.stringify(sorted(actual));
}

/** The native preview may omit the unit; the saved product comparison still requires it. */
function reviewQuantityMatches(expected, actual) {
  if (expected === actual) return true;
  const quantity = /^(\d+(?:\.\d+)?) x (\d+(?:\.\d+)?)(?: ([a-z]+))?$/;
  const before = quantity.exec(expected), after = quantity.exec(actual);
  return Boolean(before && after && !after[3]
    && Number(before[1]) === Number(after[1]) && Number(before[2]) === Number(after[2]));
}

/** Native product review omits descriptions; the saved detail must still verify them in full. */
export function sampleReviewMatches(expected, root) {
  if (!expected?.length) return false;
  const table = root.querySelector('#body-produk-masuk table');
  if (!table) return false;
  const headings = [...table.querySelectorAll('thead th')].map(cell => heading(cell.textContent));
  const columns = PRODUCT_COLUMNS.slice(0,5).map(name => headings.indexOf(name));
  if (columns[0] < 0 || columns[1] < 0) return false;
  const used = columns.flatMap((index,column) => index < 0 ? [] : [{index,column}]);
  const rows = [...table.querySelectorAll('tbody > tr')].filter(row => row.cells.length > Math.max(...columns));
  const values = rows.map(row => used.map(({index,column}) => {
    const value = normalize(row.cells[index].textContent);
    return column >= 2 && /^\d+(?:\.\d+)?$/.test(value) ? String(Number(value)) : value;
  }));
  if (expected.length !== values.length) return false;
  const remaining = [...values];
  // Match explicit units before unitless previews so duplicate codes cannot hide a wrong unit.
  const ordered = [...expected].sort((a,b) => a[1].localeCompare(b[1]));
  for (const row of ordered) {
    const matches = value => used.every(({column},index) => column === 1
      ? reviewQuantityMatches(row[column],value[index]) : row[column] === value[index]);
    let index = remaining.findIndex(value => matches(value) && value[used.findIndex(item => item.column === 1)] === row[1]);
    if (index < 0) index = remaining.findIndex(matches);
    if (index < 0) return false;
    remaining.splice(index,1);
  }
  return true;
}
