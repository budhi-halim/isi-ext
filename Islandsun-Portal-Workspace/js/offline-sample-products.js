import { splitIssuedProduct } from './product-logic.js';

const text = value => String(value || '').replace(/\s+/g,' ').trim();
const requestNumbers = value => text(value).match(/\d+\/[IVXLCDM]+\/\d{4}\/SRF/gi) || [];

/** Unissued new-product requests have no catalogue product to confirm yet. */
export function unissuedSampleStatus(root, url) {
  const route = new URL(url);
  if (!/^\/islandsun\/(?:index\.php\/)?samplerequest\/edit$/i.test(route.pathname)
    || !['2','3','5'].includes(route.searchParams.get('srtype'))
    || root.querySelector('#samplernd,#tandaTerimaSample')) return null;
  const status = text(root.querySelector('.content-wrapper label.label-info')?.textContent).toUpperCase();
  return ['PROCESS RND','DRAFT','CANCEL'].includes(status) ? status : null;
}

/** Read product identities only from rows explicitly belonging to this SRF. */
function productsFromPane(root, selector, number) {
  const products = new Map();
  for (const table of root.querySelectorAll(`${selector} table`)) {
    const headings = [...table.tHead?.rows[0]?.cells || []];
    const column = headings.findIndex(cell => /^(?:Nama Dan Kode Produk|Product name and code)$/i.test(text(cell.textContent)));
    if (column < 0) continue;
    const offset = headings.slice(0,column).reduce((sum,cell) => sum+cell.colSpan,0);
    for (const row of [...table.tBodies].flatMap(body => [...body.rows])) {
      const references = [...row.cells].flatMap(cell => requestNumbers(cell.textContent));
      if (!references.length || references.some(value => value.toUpperCase() !== number)) continue;
      const product = splitIssuedProduct(text(row.cells[offset]?.textContent));
      if (!product.name || !product.code) continue;
      products.set(product.code.toUpperCase(),product);
    }
  }
  return [...products.values()];
}

/** Reconstruct identities under the user's same-products rule, never confirmation-specific values. */
export function restoreSampleConfirmation(root, url, record) {
  const route = new URL(url);
  if (!/^\/islandsun\/(?:index\.php\/)?samplerequest\/edit$/i.test(route.pathname)
    || !['2','3','5'].includes(route.searchParams.get('srtype'))) return new Map();
  const number = text(record?.number || requestNumbers(root.querySelector('.content-wrapper')?.textContent)[0]).toUpperCase();
  if (!/^\d+\/[IVXLCDM]+\/\d{4}\/SRF$/.test(number)) return new Map();
  const issued = productsFromPane(root,'#samplernd',number);
  const receipt = productsFromPane(root,'#tandaTerimaSample',number);
  const identity = products => products.map(product => product.code.toUpperCase()).sort().join('|');
  const conflict = issued.length && receipt.length && identity(issued) !== identity(receipt);
  const products = issued.length ? issued : receipt;
  const unissuedStatus = unissuedSampleStatus(root,url);
  const results = new Map();
  for (const body of root.querySelectorAll('#productRequest #tableSP tbody')) {
    if (body.rows.length) continue;
    const table = body.closest('table');
    if (!products.length) {
      if (unissuedStatus) results.set(table,{state:'expected-empty',status:unissuedStatus});
      continue;
    }
    if (conflict) {
      results.set(table,{state:'conflict',sources:['R&D-issued samples','Sample receipt']});
      continue;
    }
    const headings = [...table.tHead?.rows[0]?.cells || []].map(cell => text(cell.textContent));
    const nameColumn = headings.findIndex(value => /^(?:Product Name|Nama Produk)$/i.test(value));
    const codeColumn = headings.findIndex(value => /^(?:Product Code|Produk Code|Kode Produk)$/i.test(value));
    if (nameColumn < 0 || codeColumn < 0) continue;
    for (const [index,product] of products.entries()) {
      const row = body.insertRow();
      headings.forEach((heading,column) => {
        row.insertCell().textContent = column === nameColumn ? product.name : column === codeColumn ? product.code
          : /^No\.?$/i.test(heading) ? String(index+1) : 'Not captured';
      });
    }
    results.set(table,{state:'reconstructed',sources:issued.length ? ['R&D-issued samples'] : ['Sample receipt'],
      corroborated:!!(issued.length && receipt.length),productCount:products.length});
  }
  return results;
}
