import { prepareOfflineDetail } from './offline-detail-presentation.js';
import { mergeProducts, splitRequestedProduct } from './product-logic.js';
import { sourceProduct } from './tir-source-logic.js';

/** Read identities only from this record's saved detail, without portal requests. */
export function offlinePreviewProducts(record) {
  if (!record?.detail) throw new Error('This detail has not been saved yet.');
  if (record.kind === 'tir') {
    const products = record.detail.fields.filter(field => /^tird_produk(?:\[\])?$/.test(field.label))
      .map(field => sourceProduct(field.value)).filter(product => product?.code);
    return [...new Map(products.map(product => [JSON.stringify(product),product])).values()];
  }
  const detail = prepareOfflineDetail(record.detail,record);
  const requested = [], issued = [];
  for (const table of detail.tables.filter(table => table.section === 'productRequest')) {
    const header = table.rows[0] || [];
    const name = header.indexOf('Product name'), code = header.indexOf('Product code');
    if (name < 0) continue;
    for (const row of table.rows.slice(table.headerRows || 1)) {
      if (row[name]) requested.push({name:row[name],code:code >= 0 && row[code] !== 'Not captured' ? row[code] || null : null});
    }
  }
  for (const table of detail.tables.filter(table => table.section === 'samplernd')) {
    const header = table.rows[0] || [], column = header.indexOf('Product name and code');
    if (column < 0) continue;
    const offset = header.slice(0,column).reduce((sum,_,index) => sum + (table.cellSpans?.[0]?.[index]?.columns || 1),0);
    for (const row of table.rows.slice(table.headerRows || 1)) {
      const value = String(row[offset] || '').replace(/\s+/g,' ').trim();
      if (value) issued.push(requested.find(product => `${product.name} ${product.code}` === value) || splitRequestedProduct(value));
    }
  }
  const original = detail.fields.find(field => field.label === 'Product name' && field.section !== 'productRequest');
  if (!requested.length && original?.value) requested.push(splitRequestedProduct(original.value));
  return mergeProducts(requested,issued);
}
