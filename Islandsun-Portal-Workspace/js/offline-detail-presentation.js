import { translateChrome } from './logic.js';
import { splitIssuedProduct } from './product-logic.js';
import { SAMPLE_APPLICATION_GROUPS } from './sample-application-groups.js';
import { sampleQuantity } from './sample-quantity.js';
import { recoverConfirmationFields } from './offline-confirmation-fields.js';

const clean = value => String(value ?? '').replace(/\s+/g,' ').trim();
const LABELS = new Map(Object.entries({
  foodregulation:'Food regulation', sr_negara:'Country', sp_primary_reason:'Reason for this product request',
  detailsamefunction:'Existing product with the same function', select_snack:'Snack type', select_meat_product:'Meat product type',
  'final_application[]':'Other final application', 'srd_detailapplication[]':'Other detailed application',
  productforms:'Product form', nameofproduct:'Product name', targetreference:'Target reference',
  qtys:'Number of samples', qtyberat:'Weight per sample', qtyberat2:'Weight per sample', qtyuom:'Sample unit',
  srd_fo:'First order', srd_fo_uom:'First order unit', srd_avg:'Average monthly quantity', srd_avg_uom:'Monthly quantity unit',
  srd_max:'Maximum capacity', srd_max_uom:'Capacity unit', srd_marketarea:'Product market area', srd_country:'Country',
  srd_kind:'Delivery service', srd_delivering:'Delivery arrangement', 'tanggal_terima_sample[]':'Sample received date',
  'komentar[]':'Comments', 'saran[]':'Suggestions', 'kesimpulan[]':'Conclusion',
  alamat:'Address', customer:'Customer', do_statuskirim:'Shipping status', do_tgl_kirim:'Dispatch date',
  ekspedisi:'Expedition', gudang:'Warehouse', no_do:'Delivery order number', no_faktur:'Invoice number',
  pic:'Person in charge', renmark:'Remarks', stbjd_id_data:'Stock reference', tax_data:'Tax',
  'stock_ctn[]':'Cartons', 'stock_jumlah[]':'Quantity', 'stock_sum[]':'Total quantity',
  'nama dan kode produk':'Product name and code', 'jumlah (gr)':'Quantity (g)', 'jumlah(gr)':'Quantity (g)',
  'nomor request':'Request number', 'nama customer':'Customer', tanggal:'Date', aksi:'Actions',
  'keterangan rnd':'R&D remarks', 'status bahan baku':'Raw material status', 'produk code':'Product code',
  desription:'Description', 'manufacture name':'Manufacturer', 'no rnd':'R&D number',
  'tanggal terima sample':'Sample received date', 'nama produk':'Product name', 'kode produk':'Product code',
  'qty kirim':'Shipped quantity', 'qty terima':'Received quantity', 'nama barang':'Product name',
  'nama sales':'Salesperson', 'no so':'Sales order number', 'no srs':'Stock request number',
  'sr no':'Request number', 'no po':'Purchase order number', 'category product':'Product category',
  'price ideal':'Requested price', 'price competitor':'Competitor price',
  'no surat jalan':'Delivery note number', 'tanggal kirim':'Dispatch date', keterangan:'Remarks',
  komentar:'Comments', saran:'Suggestions', kesimpulan:'Conclusion', 'no.':'No.',
  'no do':'Delivery order number', sales:'Salesperson', 'tgl kirim':'Dispatch date',
  'status kirim do':'Shipping status', 'jenis pajak':'Tax type', faktur:'Invoice number',
  'alamat pengriman':'Shipping address', 'information request':'Information requested',
  so_remarks:'Remarks', 'dt[so_remarks]':'Remarks',
}).map(([key,value]) => [key.toLowerCase(),value]));
const APPLICATIONS = ['Snack','Meat Product','Sauce & Paste','Biscuits, wafers & chocolate','Noodles','Beverage','Bakery','Confectionary','Others'];
const DETAILS = ['Ready to use','Premix','Oil Slurry','Sugar Coating','Ready To Serve','Sprinkle','Dough','Oil Soluble','Water soluble'];
const OPTIONS = {Keripik:'Chips',Sosis:'Sausage',Lokal:'Local',Ekspor:'Export',GRAM:'g',KG:'kg'};
const selected = field => field?.checked === true || field?.value === 'Selected';
const choice = field => ['Selected','Not selected'].includes(field?.value) || ['checkbox','radio'].includes(field?.controlType);

/** Translate interface labels without translating product names or user-authored remarks. */
export function offlineLabel(value) {
  const label = clean(value).replace(/\s*:\s*$/,'');
  const known = LABELS.get(label.toLowerCase());
  if (known) return known;
  const translated = translateChrome(label);
  if (translated !== label) return translated;
  return label.replace(/^(?:dt|data)\[([^\]]+)\]$/, '$1').replace(/\[\]$/, '')
    .replace(/^(?:sr|srd|srs|tir|do)_/,'').replaceAll('_',' ').replace(/^./,letter => letter.toUpperCase());
}

function omitActionColumns(table) {
  if (!table.headerRows) return table;
  const occupied = [], omitted = new Set();
  const columns = table.rows.map((row,rowIndex) => {
    let column = 0;
    const positions = row.map((label,cellIndex) => {
      while (occupied[column] > 0) column++;
      const span = table.cellSpans?.[rowIndex]?.[cellIndex];
      const width = span?.columns || 1;
      const position = Array.from({length:width},(_,offset) => column+offset);
      if (rowIndex < table.headerRows && /^(Actions|Check)$/i.test(label)) position.forEach(value => omitted.add(value));
      const height = span?.rows === 0 ? table.rows.length-rowIndex : span?.rows || 1;
      for (const index of position) occupied[index] = height;
      column += width;
      return position;
    });
    occupied.forEach((remaining,index) => { occupied[index] = Math.max(0,remaining-1); });
    return positions;
  });
  if (!omitted.size || columns.some(row => row.some(position => position.some(index => omitted.has(index)) && !position.every(index => omitted.has(index))))) return table;
  for (const key of ['rows','cellSpans','cellTables','rowHeaders','cellMultiline','cellParts']) {
    if (table[key]) table[key] = table[key].map((row,index) => row.filter((_,cell) => !columns[index][cell].every(column => omitted.has(column))));
  }
  return table;
}

function tablePresentation(table) {
  const result = {...table,title:offlineLabel(table.title),rows:table.rows.map((row,index) => row.map((cell,column) =>
    index < (table.headerRows || 0) || table.rowHeaders?.[index]?.[column] ? offlineLabel(cell) : /quantity|qty|jumlah/i.test(table.rows[0]?.[column] || '') ? sampleQuantity(cell) : cell))};
  result.cellTables = table.cellTables?.map(row => row.map(tables => tables.map(tablePresentation)));
  result.cellParts = table.cellParts?.map((row,index) => row.map((parts,column) => {
    if (index < (table.headerRows || 0) || !/quantity|qty|jumlah/i.test(table.rows[0]?.[column] || '')) return parts;
    return parts.map((part,position) => {
      if (!['text','value'].includes(part.type)) return part;
      const packSeparator = part.type === 'text' && /^\s*x\s*$/i.test(part.value)
        && [parts[position-1],parts[position+1]].every(adjacent => adjacent?.type === 'value' && /^\d+(?:[.,]\d+)?$/.test(adjacent.value));
      return {...part,value:packSeparator ? part.value.replace(/x/i,'×') : sampleQuantity(part.value)};
    });
  }));
  return omitActionColumns(result);
}

function specialSampleRoute(record) {
  const number = clean(record.number).toUpperCase();
  if (record.kind !== 'sample' || !/^\d+\/[IVXLCDM]+\/\d{4}\/SRF$/.test(number)) return false;
  if (!record.detailUrl || !URL.canParse(record.detailUrl)) return false;
  const route = new URL(record.detailUrl);
  return /^\/islandsun\/(?:index\.php\/)?samplerequest\/edit$/i.test(route.pathname)
    && ['2','3','5'].includes(route.searchParams.get('srtype'))
    && String(record.id) === route.searchParams.get('id');
}

/** Recover from the very same saved snapshot, including records too old for bound raw replay. */
function recoverProducts(tables, record) {
  if (!specialSampleRoute(record)) return;
  const number = clean(record.number).toUpperCase();
  function products(section) {
    const found = new Map();
    for (const table of tables.filter(table => table.section === section)) {
      const headings = table.rows[0] || [];
      const column = headings.findIndex(label => /^Product name and code$/i.test(label));
      if (column < 0) continue;
      const offset = headings.slice(0,column).reduce((sum,_,index) => sum+(table.cellSpans?.[0]?.[index]?.columns || 1),0);
      for (const row of table.rows.slice(table.headerRows || 1)) {
        const references = row.flatMap(cell => clean(cell).match(/\d+\/[IVXLCDM]+\/\d{4}\/SRF/gi) || []);
        if (!references.length || references.some(reference => reference.toUpperCase() !== number)) continue;
        const item = splitIssuedProduct(clean(row[offset]));
        if (item.name && item.code) found.set(item.code,item);
      }
    }
    return [...found.values()];
  }
  const issued = products('samplernd'), receipt = products('tandaTerimaSample');
  const identities = items => items.map(item => item.code.toUpperCase()).sort().join('|');
  for (const table of tables.filter(table => table.section === 'productRequest' && table.rows.length === table.headerRows)) {
    const nameColumn = table.rows[0]?.findIndex(label => /^Product name$/i.test(label));
    const codeColumn = table.rows[0]?.findIndex(label => /^Product code$/i.test(label));
    if (!(nameColumn >= 0 && codeColumn >= 0)) continue;
    if (issued.length && receipt.length && identities(issued) !== identities(receipt)) {
      table.productRecovery = {state:'conflict'};
      continue;
    }
    const products = issued.length ? issued : receipt;
    if (!products.length) continue;
    table.rows.push(...products.map((product,index) => table.rows[0].map((label,column) =>
      column === nameColumn ? product.name : column === codeColumn ? product.code : /^No\.?$/i.test(label) ? String(index+1) : 'Not captured')));
    table.pending = false;
    table.productRecovery = {state:'reconstructed',sources:[issued.length ? 'R&D-issued samples' : 'Sample receipt'],corroborated:!!(issued.length && receipt.length),productCount:products.length};
  }
}

/** Recognize a saved native header, never a status from a newer list or a user's remarks. */
function unissuedStatus(detail, record) {
  if (!specialSampleRoute(record) || detail.sections?.some(section => ['samplernd','tandaTerimaSample'].includes(section.id))) return null;
  const header = clean(detail.text).match(/^Detail[^|]{0,100}?NO SRF\s*:\s*(\d+\/[IVXLCDM]+\/\d{4}\/SRF)\s*\|\s*Last Update\s*:\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*\|\s*(PROCESS RND|DRAFT|CANCEL)\s*\|/i);
  return header && header[1].toUpperCase() === clean(record.number).toUpperCase() ? header[2].toUpperCase() : null;
}

function sampleFields(fields, section) {
  const find = label => fields.find(field => field.label === label);
  const omitted = new Set();
  const replacements = new Map();
  function replace(labels, result) {
    const originals = fields.filter(field => labels.includes(field.label));
    if (!originals.length) return;
    originals.forEach(field => omitted.add(field));
    const sourceTable = originals[0].sourceTable;
    replacements.set(originals[0],{...result,section,
      ...(sourceTable && originals.every(field => field.sourceTable === sourceTable) ? {sourceTable} : {})});
  }
  const yes = find('Yes'), no = find('No');
  if (choice(yes) && choice(no)) {
    const existing = find('detailsamefunction');
    replace(['Yes','No','detailsamefunction'],{label:'Is there a product in house performing the same function?',multiline:true,selectionType:'single',
      options:[{label:'Yes',checked:selected(yes),detail:selected(yes) ? existing?.value : ''},{label:'No',checked:selected(no)}]});
  }
  function choices(labels, title, otherKey) {
    const options = fields.filter(field => labels.includes(field.label) && choice(field));
    if (!options.length) return;
    const extras = labels === APPLICATIONS ? ['select_snack','select_meat_product',otherKey] : [otherKey];
    const extra = find(otherKey);
    const items = options.map(field => ({label:offlineLabel(field.label),checked:selected(field),
      detail:selected(field) ? field.label === 'Snack' ? OPTIONS[find('select_snack')?.value] || find('select_snack')?.value
        : field.label === 'Meat Product' ? OPTIONS[find('select_meat_product')?.value] || find('select_meat_product')?.value
        : field.label === 'Others' ? extra?.value : '' : ''}));
    if (extra?.value && labels !== APPLICATIONS) items.push({label:'Other',checked:true,detail:extra.value});
    const groups = labels === DETAILS ? SAMPLE_APPLICATION_GROUPS.map(group => ({name:group.name,required:group.required,
      options:items.filter(item => group.options.some(label => offlineLabel(label) === item.label))})) : undefined;
    replace([...options.map(field => field.label),...extras],{label:title,options:items,groups,multiline:true});
  }
  choices(APPLICATIONS,'Final application','final_application[]');
  choices(DETAILS,'Detailed application','srd_detailapplication[]');
  if (find('foodregulation') && find('sr_negara')) replace(['foodregulation','sr_negara'],{
    label:'Food regulation',parts:[{label:'Food regulation',value:find('foodregulation').value},{label:'Country',value:find('sr_negara').value}]
  });
  for (const [valueKey,unitKey,label] of [['srd_fo','srd_fo_uom',section === 'requestInfo2' ? 'Monthly potential' : 'First order'],['srd_avg','srd_avg_uom','Average quantity per month'],['srd_max','srd_max_uom','Maximum capacity']]) {
    if (find(valueKey)) replace([valueKey,unitKey],{label,value:[find(valueKey).value,OPTIONS[find(unitKey)?.value] || find(unitKey)?.value].filter(value => value != null && value !== '').join(' ')});
  }
  if (find('qtys') && (find('qtyberat2') || find('qtyberat'))) replace(['qtys','qtyberat2','qtyberat','qtyuom'],{label:'Sample quantity',value:`${find('qtys').value} × ${(find('qtyberat2') || find('qtyberat')).value} ${OPTIONS[find('qtyuom')?.value] || find('qtyuom')?.value || ''}`.trim()});
  return fields.flatMap(field => replacements.has(field) ? [replacements.get(field)] : omitted.has(field) ? [] : [field]);
}

function tirFields(fields) {
  const requested = fields.filter(field => field.sourceGroup && choice(field)
    && (field.sourceControl === 'dt[srd_technicalinformation][]' || /^myCheck|^coa_check$/.test(field.sourceControl || '') || field.label === 'Others'));
  if (!requested.length || new Set(requested.map(field => field.sourceGroup)).size !== 1) return fields;
  const other = fields.find(field => field.sourceControl === 'txt-others-technicalinformation');
  const combined = {...requested[0],label:'Information requested',selectionType:'multiple',
    options:requested.map(field => ({label:field.label,checked:selected(field),
      ...(field.label === 'Others' && other ? {inlineDetail:true,detail:other.value} : {})}))};
  return fields.flatMap(field => field === requested[0] ? [combined] : requested.includes(field) || field === other ? [] : [field]);
}

/** Present old and current snapshots consistently without modifying their stored business values. */
export function prepareOfflineDetail(detail, record) {
  if (!detail) return detail;
  let sections = (detail.sections || []).map(section => ({...section,title:offlineLabel(section.title)}));
  if (record.kind === 'sample') {
    const order = ['requestInfo','requestInfo2','productRequest','samplernd','tandaTerimaSample','tandaTerima','feedback'];
    sections.sort((a,b) => (order.includes(a.id) ? order.indexOf(a.id) : 99)-(order.includes(b.id) ? order.indexOf(b.id) : 99));
  }
  const sectionTitles = new Set(sections.map(section => section.title.toLowerCase()));
  let fields = (detail.fields || []).filter(field => !(choice(field) && (!field.section && sectionTitles.has(offlineLabel(field.label).toLowerCase()) || /^\d+$/.test(field.label))));
  if (record.kind === 'sample') fields = [...new Set(fields.map(field => field.section || ''))].flatMap(section => sampleFields(fields.filter(field => (field.section || '') === section),section));
  if (record.kind === 'tir') fields = tirFields(fields);
  fields = fields.map(field => ({...field,label:offlineLabel(field.label),
    value:record.kind === 'delivery' && field.sourceControl === 'do_statuskirim' ? translateChrome(field.value)
      : record.kind === 'delivery' && field.sourceControl === 'ekspedisi' && /^-*\s*Pilih Ekspedisi\s*-*$/i.test(field.value) ? '' : field.value}));
  let tables = (detail.tables || []).map(tablePresentation).filter(table => {
    if (record.kind !== 'sample' || table.headerRows || table.rows.length !== 1) return true;
    const contents = clean(table.rows[0].join(' ')).toLowerCase();
    return !fields.some(field => ['Monthly potential','First order','Average quantity per month','Maximum capacity'].includes(field.label)
      && field.section === table.section && clean(field.value).toLowerCase() === contents);
  });
  recoverProducts(tables,record);
  tables = recoverConfirmationFields(tables,detail.confirmationSheet,record);
  const displayedTables = new Set(tables.map(table => table.sourceTable).filter(Boolean));
  fields = fields.filter(field => !field.sourceTable || !displayedTables.has(field.sourceTable));
  const status = unissuedStatus(detail,record);
  if (status) {
    for (const table of tables.filter(table => table.section === 'productRequest' && table.rows.length === table.headerRows)) {
      table.pending = false; table.productRecovery = {state:'expected-empty',status};
    }
    // Legacy unused receipt markup is not an issued/receipt tab in this native state.
    const legacy = tables.filter(table => table.section === 'tandaTerima');
    if (legacy.length && legacy.every(table => table.rows.length === table.headerRows) && !fields.some(field => field.section === 'tandaTerima')) {
      tables = tables.filter(table => table.section !== 'tandaTerima');
      sections = sections.filter(section => section.id !== 'tandaTerima');
    }
  }
  const understood = tables.some(table => ['reconstructed','expected-empty'].includes(table.productRecovery?.state));
  return {...detail,fields,tables,sections,supplementaryComplete:understood ? !tables.some(table => table.pending) : detail.supplementaryComplete};
}
