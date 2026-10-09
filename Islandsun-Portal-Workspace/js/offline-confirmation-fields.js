import { sampleQuantity } from './sample-quantity.js';

const codeKey = value => String(value ?? '').trim().toUpperCase();

/** Fill missing cells on existing confirmation rows without creating products or replacing native values. */
export function recoverConfirmationFields(tables, sheet, record) {
  if (!sheet || record.kind !== 'sample' || sheet.number !== record.number || sheet.detailUrl !== record.detailUrl
    || sheet.fingerprint !== record.fingerprint || !Number.isFinite(sheet.capturedAt)) return tables;
  const products = new Map(), duplicates = new Set();
  for (const product of sheet.products || []) {
    const key = codeKey(product.code);
    if (!key) continue;
    if (products.has(key)) duplicates.add(key);
    products.set(key,product);
  }
  return tables.map(table => {
    if (table.section !== 'productRequest' || table.productRecovery?.state !== 'reconstructed' || table.headerRows !== 1) return table;
    const headings = table.rows[0], code = headings.findIndex(label => /^Product code$/i.test(label));
    const columns = [['quantity',headings.findIndex(label => /^Sample (?:QTY|quantity)$/i.test(label))],
      ['description',headings.findIndex(label => /^Description$/i.test(label))]];
    if (code < 0) return table;
    const codes = table.rows.slice(1).map(row => codeKey(row[code]));
    const recovered = [], changed = new Set();
    const rows = table.rows.map((row,index) => {
      if (!index) return row;
      const key = codeKey(row[code]), product = products.get(key);
      if (!product || duplicates.has(key) || codes.filter(value => value === key).length !== 1) return row;
      const result = [...row], fields = [];
      for (const [field,column] of columns) {
        if (column < 0 || row[column] !== 'Not captured' || typeof product[field] !== 'string'
          || field === 'quantity' && !product[field].trim()) continue;
        result[column] = field === 'quantity' ? sampleQuantity(product[field]) : product[field];
        fields.push(field); changed.add(`${index}:${column}`);
      }
      if (fields.length) recovered.push({code:row[code],fields});
      return result;
    });
    if (!recovered.length) return table;
    return {...table,rows,
      cellParts:table.cellParts?.map((row,index) => row.map((parts,column) => changed.has(`${index}:${column}`) ? [] : parts)),
      productRecovery:{...table.productRecovery,sheetFields:{url:sheet.url,capturedAt:sheet.capturedAt,products:recovered}}};
  });
}
