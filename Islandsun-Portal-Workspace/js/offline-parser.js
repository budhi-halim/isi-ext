import { OFFLINE_SOURCES, businessDate, archiveKey, PORTAL_HOME } from './offline-config.js';
import { requestDetailUrl, tirDetailUrl, sampleType, translateChrome } from './logic.js';
import { availableDocuments } from './shared/document-dom.js';
import { samplePrintLinks } from './offline-sample-print.js';
import { applySavedDetailValues } from './offline-detail-adapters.js';
import { invalidIndexIdentity, omittedIndexRow, includedIndexRows } from './offline-index-identity.js';
import { availabilityIdentity } from './offline-logistics.js';
import { HTML_SOURCES } from './offline-html-sources.js';
import { restoreSampleConfirmation, unissuedSampleStatus } from './offline-sample-products.js';
import { createSavedFormLayout, siblingFieldLabel } from './offline-form-layout.js';
import { translateNativeFormLabels } from './native-form-labels.js';

const text = value => String(value || '').replace(/\s+/g, ' ').trim();
function parse(html) { return new DOMParser().parseFromString(html, 'text/html'); }
export function plainValue(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  let result = String(value);
  try { const list = JSON.parse(result); if (Array.isArray(list)) return list.filter(Boolean).join(', '); } catch { /* Plain source text is common. */ }
  if (/<[^>]+>/.test(result)) result = parse(result).body.textContent;
  return text(result);
}

export function parseIdentity(html) {
  const root = parse(html);
  const anchor = root.querySelector('.user-menu a[href*="lockscreen?user="]');
  if (!anchor || !root.querySelector('.content-wrapper')) return null;
  const url = new URL(anchor.getAttribute('href'), PORTAL_HOME);
  const account = url.searchParams.get('user');
  return account ? {account, name:text(root.querySelector('.user-menu > a')?.textContent) || account} : null;
}

export function normalizeIndex(account, kind, payload, {partial = false, includeOmitted = false, start = 0} = {}) {
  const source = OFFLINE_SOURCES[kind];
  const rows = kind === 'products' ? payload : payload?.data;
  if (!source || !Array.isArray(rows) || !partial && kind !== 'products' && Number(payload.recordsFiltered) !== rows.length) throw new Error('The portal returned an incomplete list.');
  const records = rows.map((row,index) => {
    const object = row && typeof row === 'object' && !Array.isArray(row);
    const rawId = object ? row[source.id] : null;
    let id = ['string','number'].includes(typeof rawId) ? String(rawId).trim() : '';
    const rawNumber = object ? row[source.number] : null;
    const number = ['string','number'].includes(typeof rawNumber) ? plainValue(rawNumber) : '';
    const reason = invalidIndexIdentity(kind,id,number);
    if (reason) return omittedIndexRow(account,kind,start+index,reason,id,number);
    const date = source.date ? businessDate(row[source.date]) : null;
    const pendingDate = (kind === 'availability' || HTML_SOURCES[kind]?.requestDates) && row.source_date_pending === true;
    if (source.date && !date && !pendingDate) throw new Error('A record has no valid entry date. The previous saved list has been retained.');
    const fields = Object.fromEntries(Object.entries(row).filter(([key]) => !/^(view\d*|action\w*|csrf.*|token|password)$/i.test(key)).map(([key, value]) => [key, plainValue(value)]));
    // The published price list can contain distinct names/prices sharing a code.
    if (kind === 'products') id = JSON.stringify([fields.product_code,fields.product_name,fields.marketing_price]);
    let detailUrl = kind === 'sample' ? requestDetailUrl(id, sampleType(row.sr_srtype)) : kind === 'tir' ? tirDetailUrl(id) : null;
    if (kind === 'sales' && /^\d+$/.test(id)) detailUrl = `${PORTAL_HOME}sales-order/edit/${id}`;
    if (kind === 'stock' && /^\d+$/.test(id)) detailUrl = `${PORTAL_HOME}stock-request/detail-srs/${id}`;
    if (kind === 'availability') detailUrl = availabilityIdentity(row).detailUrl;
    if (source.stockRows && row.related_order_id) {
      if (!/^\d+$/.test(row.related_order_id)) throw new Error('The related sales-order lookup was not recognized.');
      detailUrl = `${PORTAL_HOME}StockCard/showSoData?srsc_id=${row.related_order_id}`;
    }
    const detailPath = {delivery:'NewDo/detailDO/',returns:'stock-request/detail_complain/',sudden:'Suddenrequest/detail-sudden/'}[kind];
    if (detailPath) {
      if (!/^\d+$/.test(id)) throw new Error('The portal returned an invalid record identifier.');
      detailUrl = `${PORTAL_HOME}${detailPath}${id}`;
    }
    return {key:archiveKey(account,kind,id), account, kind, id, date, pendingDate, number, fields, detailUrl, fingerprint:JSON.stringify(fields), savedAt:Date.now()};
  });
  const result = kind === 'products' ? [...new Map(records.map(record=>[record.key,record])).values()] : records;
  return includeOmitted ? result : includedIndexRows(result);
}

/** Native client-side tables already contain the full result in their signed-in HTML response. */
export function parseHtmlRows(account,kind,html,url) {
  const source = HTML_SOURCES[kind];
  const expected = source && new URL(source.path,PORTAL_HOME);
  const requested = new URL(url);
  if (source?.periodic) {
    const month = requested.searchParams.get('bulan'), year = requested.searchParams.get('tahun');
    if (!/^(0[1-9]|1[0-2])$/.test(month) || !/^\d{4}$/.test(year) || Number(year)<1) throw new Error('Choose a valid reporting period.');
    expected.search = new URLSearchParams({bulan:month,tahun:year});
  }
  if (!source || url !== expected.href || parseIdentity(html)?.account !== account) throw new Error('The signed-in account or table source changed. This list was not archived.');
  const root = parse(html), table = root.querySelector(source.table);
  if (source.periodic && (root.querySelector('select[name="bulan"]')?.value!==requested.searchParams.get('bulan') || root.querySelector('select[name="tahun"]')?.value!==requested.searchParams.get('tahun'))) throw new Error('The portal did not return the requested reporting period.');
  const headings = [...table?.tHead?.rows[0]?.cells || []].map(cell => text(cell.textContent));
  if (JSON.stringify(headings) !== JSON.stringify(source.headers)) throw new Error('The stock table columns were not recognized. The previous copy is retained.');
  const rows = [...table.tBodies].flatMap(body => [...body.rows]);
  const data = rows.filter(row => !(row.cells.length === 1 && row.cells[0].classList.contains('dataTables_empty'))).map(row => {
    if (row.cells.length !== source.columns.length) throw new Error('The stock table contains an incomplete row.');
    const values = Object.fromEntries(source.columns.map((key,index) => [key,text(row.cells[index].textContent)]).filter(([key]) => !['sequence','actions'].includes(key)));
    if (kind === 'stock-adjustment') {
      const anchor = row.cells[source.columns.indexOf('actions')].querySelector('a[href]');
      values.stock_id = '';
      try {
        const target = anchor && new URL(anchor.getAttribute('href'),url);
        if (target?.origin === new URL(PORTAL_HOME).origin) values.stock_id = target.pathname.match(/^\/islandsun\/StockCard\/AdjustmenAdd\/(\d+)\/?$/)?.[1] || '';
      } catch { /* A malformed native identifier is omitted by the shared identity policy. */ }
    }
    if (source.columns.includes('related_orders')) {
      const action = row.cells[source.columns.indexOf('related_orders')].querySelector('[onclick]')?.getAttribute('onclick') || '';
      values.related_order_id = action.match(/^\s*showSOData\(\s*(\d+)\s*\)\s*;?\s*$/)?.[1] || '';
      if (values.related_orders === 'SO Tersedia' && !values.related_order_id) throw new Error('The stock row has an unrecognized sales-order link.');
      values.related_orders = ({'SO Tersedia':'Sales orders available','Tidak ada SO':'No sales orders'})[values.related_orders] || values.related_orders;
    }
    return values;
  });
  return data;
}

export function parseHtmlIndex(account,kind,html,url,options) {
  const data = parseHtmlRows(account,kind,html,url);
  const records = normalizeIndex(account,kind,{data,recordsFiltered:data.length},options);
  if (new Set(records.map(record => record.key)).size !== records.length) throw new Error('The stock summary contains duplicate record identifiers. The previous copy is retained.');
  return records;
}

/** Related-order fragments are validated and wrapped only in an inert detached document. */
export function parseStockOrders(html,url,record) {
  const source = OFFLINE_SOURCES[record?.kind], id = record?.fields?.related_order_id;
  if (!source?.stockRows || !/^\d+$/.test(id) || url !== `${PORTAL_HOME}StockCard/showSoData?srsc_id=${id}`) throw new Error('This sales-order lookup does not match the stock row.');
  const root = parse(`<table><tbody>${html}</tbody></table>`), table = root.querySelector('table');
  const rows = [...table.tBodies[0].rows];
  if (!rows.length && html.trim()) throw new Error('The portal returned no recognized sales-order table.');
  for (const row of rows) {
    const link = row.cells[1]?.querySelector('a[href]');
    const target = link && new URL(link.getAttribute('href'),url);
    if (row.cells.length !== 6 || !target || target.origin !== new URL(PORTAL_HOME).origin || !/^\/islandsun\/sales-order\/edit\/\d+\/?$/i.test(target.pathname)) throw new Error('The related sales-order row was not recognized.');
  }
  return {title:source.title,sections:[],documents:[],
    fields:source.columns.map(column => ({label:column.label,value:record.fields[column.key]})),
    tables:[{title:'Related sales orders',headerRows:1,rows:[['No','Sales order','Date','Customer','PIC','Quantity'],...rows.map(row => [...row.cells].map(cell => text(cell.textContent)))]}]};
}

/** Availability detail responses are fragments; their enclosing session is checked separately. */
export function parseAvailabilityDetail(html,url,record) {
  if (record?.kind !== 'availability' || url !== availabilityIdentity(record.fields).detailUrl) throw new Error('This availability detail does not match the saved record.');
  const root = parse(html);
  if (!root.querySelector('.table-detail')) throw new Error('The portal returned no saved availability details.');
  const stockIds = [...root.querySelectorAll('a[href]')].map(anchor => {
    const link = new URL(anchor.getAttribute('href'),url);
    return link.origin === new URL(PORTAL_HOME).origin ? link.pathname.match(/^\/islandsun\/stock-request\/detail-srs\/(\d+)$/i)?.[1] : null;
  }).filter(Boolean);
  if (!stockIds.includes(record.fields.source_stock_id)) throw new Error('The availability detail refers to a different Stock Request.');
  const main = root.createElement('div'); main.className = 'content-wrapper';
  main.append(...root.body.childNodes); root.body.append(main);
  const title = root.createElement('h1'); title.textContent = 'Product Availability'; main.prepend(title);
  return parseDetail(root,url,'',record);
}

/** Collapse template whitespace while preserving authored textarea text and explicit breaks. */
function tableCellData(cell, controls) {
  const parts = [];
  function visit(node) {
    if (node.nodeType === 3) {
      if (typeof parts.at(-1) === 'string') parts[parts.length-1] += node.textContent;
      else parts.push(node.textContent);
    } else if (node.nodeType === 1) {
      if (node !== cell && node.tagName === 'TABLE') return;
      if (controls.has(node)) parts.push(controls.get(node));
      else if (node.hasAttribute('data-offline-multiline')) parts.push({type:'text',value:node.textContent});
      else if (node.tagName === 'BR') parts.push({type:'text',value:'\n'});
      else node.childNodes.forEach(visit);
    }
  }
  visit(cell);
  const content = parts.map(part => typeof part === 'string' ? {type:'text',value:part.replace(/\s+/g,' ')} : part);
  const value = content.map((part,index) => part.type === 'choice'
    ? `(${part.checked ? 'selected' : 'not selected'})${/^\s/.test(content[index+1]?.value || '') ? '' : ' '}`
    : part.value).join('').trim();
  return {value,content:content.some(part => part.type !== 'text') ? content : [],
    multiline:content.some(part => typeof part.value === 'string' && /\n/.test(part.value))};
}

/** Preserve nested schedules and grouped headers without retaining executable markup. */
function parseTable(table, section, controls) {
  const rows = [...table.rows];
  const labelRows = rows.map(row => row.cells.length === 3 && text(row.cells[1].textContent) === ':' && row.cells[0].tagName === 'TH');
  let headerRows = 0;
  for (const [index,row] of rows.entries()) {
    if (labelRows[index]) break;
    if (row.parentElement.tagName !== 'THEAD' && ![...row.cells].every(cell => cell.tagName === 'TH')) break;
    headerRows++;
  }
  const nestedTables = rows.map(row => [...row.cells].map(cell => [...cell.querySelectorAll('table')]
    .filter(child => child.parentElement.closest('table') === table)
    .map(child => parseTable(child, section, controls))));
  const cells = rows.map(row => [...row.cells].map(cell => tableCellData(cell, controls)));
  return {
    title:translateChrome(text(table.caption?.textContent)) || 'Record information',
    section, headerRows, rows:cells.map(row => row.map(cell => cell.value)),
    formLayout:headerRows === 0 && rows.some(row => row.querySelector('th')) && cells.some(row => row.some(cell => cell.content.some(part => part.type !== 'text'))),
    rowHeaders:rows.map((row,index) => [...row.cells].map((cell,column) => index >= headerRows && cell.tagName === 'TH' && (!labelRows[index] || column === 0))),
    cellSpans:rows.map(row => [...row.cells].map(cell => ({rows:cell.rowSpan,columns:cell.colSpan}))),
    cellTables:nestedTables,
    cellMultiline:cells.map(row => row.map(cell => cell.multiline)),
    cellParts:cells.map(row => row.map(cell => cell.content)),
  };
}

/** Preserve the native previous-request reference without retaining its online navigation target. */
function previousSampleReference(main, sectionFor) {
  for (const label of main.querySelectorAll('label')) {
    if (label.closest('.modal')) continue;
    if (!/^previous\s+(?:sr|sample request)\s*:?$/i.test(text(label.textContent))) continue;
    for (const target of label.parentElement.querySelectorAll('button,a[href]')) {
      const value = text(target.textContent);
      if (!/^\d+\/[IVXLCDM]+\/\d{4}\/SRF\b/i.test(value)) continue;
      const field = {label:'Previous SR',value,section:sectionFor(label)};
      if (target.tagName === 'A') {
        const route = new URL(target.href);
        if (route.origin === new URL(PORTAL_HOME).origin
          && /^\/islandsun\/(?:index\.php\/)?samplerequest\/edit$/i.test(route.pathname)
          && /^[1-9]\d*$/.test(route.searchParams.get('id') || '')) {
          field.reference = {kind:'sample',id:route.searchParams.get('id')};
        }
      }
      return field;
    }
  }
  return null;
}

/** Store inert text and selected values, never executable portal HTML or session fields. */
export function parseDetail(html, url, supplementary = null, record = null) {
  const root = typeof html === 'string' ? parse(html) : html.cloneNode(true);
  if (!root.querySelector('.content-wrapper')) throw new Error('The portal returned a sign-in page instead of the record.');
  applySavedDetailValues(root,record);
  for (const anchor of root.querySelectorAll('a[href]')) anchor.setAttribute('href', new URL(anchor.getAttribute('href'), url).href);
  if (supplementary != null) {
    const table = root.querySelector('#productRequest #tableSP tbody');
    const fragment = parse(`<table><tbody>${supplementary}</tbody></table>`);
    table?.replaceChildren(...fragment.querySelectorAll('tbody > tr'));
  }
  const documents = [...availableDocuments(root),...samplePrintLinks(root,url)];
  const main = root.querySelector('.content-wrapper');
  translateNativeFormLabels(main);
  if (record?.kind === 'sales') {
    // The native product grid has a hidden code cell with no corresponding header.
    for (const control of main.querySelectorAll('td.hide > input[name="dtd[sop_product_code][]"]')) control.parentElement.remove();
  }
  const layout = createSavedFormLayout(main,record?.kind);
  if (record?.kind === 'tir' && !main.querySelector('#coa_check')?.checked) {
    const coa = main.querySelector('#coa_form');
    if (coa && ![...coa.querySelectorAll('input,select,textarea')].some(control => text(control.value))) coa.remove();
  }
  if (record?.kind === 'delivery') {
    const internal = main.querySelector('#stbjd_id_data');
    if (internal?.hidden || internal?.style.display === 'none') internal.remove();
    for (const checkbox of main.querySelectorAll('input[name="checksrf"]')) {
      const cell = checkbox.closest('td');
      if (cell?.hidden && !text(cell.textContent)
        && [...cell.querySelectorAll('input')].every(control => ['hidden','checkbox'].includes(control.type))) cell.remove();
    }
    const invoice = main.querySelector('#faktur_row');
    if (invoice?.hidden && ![...invoice.querySelectorAll('input')].some(control => text(control.value))) invoice.remove();
  }
  const previous = previousSampleReference(main,element => element.closest('.tab-pane')?.id || '');
  for (const label of main.querySelectorAll('label#lbl-total')) {
    if (label.hidden || label.style.display === 'none') label.remove();
    else label.textContent = translateChrome(text(label.textContent));
  }
  // Native Sample templates retain a legacy receipt even when no receipt tab is offered.
  const legacyReceipt = main.querySelector('.tab-pane#tandaTerima');
  const hasReceiptLink = [...main.querySelectorAll('a[href]')].some(anchor => new URL(anchor.href,url).hash === '#tandaTerima');
  const detailRoute = new URL(url,PORTAL_HOME);
  const generalWithoutReceipt = /^\/islandsun\/(?:index\.php\/)?samplerequest\/edit$/i.test(detailRoute.pathname)
    && ['1','4'].includes(detailRoute.searchParams.get('srtype'))
    && main.querySelector('.tab-pane#requestInfo.active')
    && [...main.querySelectorAll('a[data-toggle="tab"][href]')].some(anchor => new URL(anchor.href,url).hash === '#productRequest')
    && legacyReceipt?.querySelector('#res-cart2')?.rows.length === 0;
  if (legacyReceipt && !legacyReceipt.classList.contains('active') && !hasReceiptLink
    && (main.querySelector('.tab-pane#tandaTerimaSample') || generalWithoutReceipt || unissuedSampleStatus(root,url))) legacyReceipt.remove();
  const confirmationSources = restoreSampleConfirmation(root,url,record);
  const pendingTables = [...main.querySelectorAll('#productRequest #tableSP tbody,#res-cartprod,#res-cart2')]
    .filter(body => !body.rows?.length && !(body.closest('#productRequest #tableSP') && supplementary != null)
      && confirmationSources.get(body.closest('table'))?.state !== 'expected-empty')
    .map(body => ({section:body.closest('.tab-pane')?.id || '',tableId:body.closest('table')?.id || ''}));
  // Quantity values are sometimes styled as buttons without an action.
  for (const button of main.querySelectorAll('td button,th button')) {
    if (/^\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s+(?:GRAM|KG|G|CASES|CARTON|DRUM))?$/i.test(text(button.textContent))) {
      button.replaceWith(root.createTextNode(text(button.textContent)));
    }
  }
  main.querySelectorAll('script,style,iframe,object,embed,button,input[type="hidden"],input[type="password"],input[type="file"],.modal,.breadcrumb').forEach(node => node.remove());
  const tabs = [...main.querySelectorAll('.nav-tabs a[href],.nav-pills a[href],a[data-toggle="tab"][href]')];
  const sections = [...main.querySelectorAll('.tab-pane')].map((pane,index) => ({
    id:pane.id || `section-${index}`,
    title:translateChrome(text(tabs.find(anchor => new URL(anchor.href,url).hash === `#${pane.id}`)?.textContent) || text(pane.querySelector('h2,h3,legend')?.textContent) || 'Record information'),
  }));
  const sectionFor = element => element.closest('.tab-pane')?.id || '';
  const sourceTables = [...main.querySelectorAll('table')].filter(table => !table.parentElement?.closest('table'));
  const tableKeys = new Map(sourceTables.map((table,index) => [table,`table-${index}`]));
  function sourceTableFor(control) {
    let table = control.closest('table');
    while (table?.parentElement?.closest('table')) table = table.parentElement.closest('table');
    return tableKeys.get(table);
  }
  const fields = [];
  const controls = new WeakMap();
  for (const control of main.querySelectorAll('input,select,textarea')) {
    if (['submit','reset','button'].includes(control.type)) { control.remove(); continue; }
    const cell = control.closest('td,th');
    const previous = cell?.previousElementSibling;
    const labelCell = text(previous?.textContent) === ':' ? previous.previousElementSibling : previous;
    const rowLabel = labelCell?.tagName === 'TH' ? text(labelCell.textContent) : '';
    if (['radio','checkbox'].includes(control.type)) {
      const adjacentLabel = control.nextSibling?.nodeType === 3 ? text(control.nextSibling.textContent).replace(/\s*:\s*$/, '') : '';
      const label = text(control.labels?.[0]?.textContent) || adjacentLabel || siblingFieldLabel(control) || (control.value !== 'on' ? text(control.value) : '') || rowLabel || 'Option';
      const value = control.checked ? 'Selected' : 'Not selected';
      fields.push({label:translateChrome(label),value,section:sectionFor(control),multiline:false,controlType:control.type,sourceTable:sourceTableFor(control),...layout.field(control)});
      const replacement = root.createElement('span');
      replacement.textContent = `(${value.toLowerCase()}) `;
      controls.set(replacement,{type:'choice',kind:control.type,checked:control.checked});
      control.replaceWith(replacement);
      continue;
    }
    const label = text(control.labels?.[0]?.textContent) || text(control.closest('.form-group')?.querySelector('label')?.textContent) || siblingFieldLabel(control) || rowLabel || control.name || control.id;
    const value = control.tagName === 'SELECT' ? [...control.selectedOptions].map(option => text(option.textContent)).join(', ') : control.value;
    const multiline = control.tagName === 'TEXTAREA';
    const savedValue = multiline ? String(value || '').replace(/\r\n?/g,'\n').trim() : text(value);
    if (label) fields.push({label:translateChrome(label),value:savedValue,section:sectionFor(control),multiline,sourceTable:sourceTableFor(control),...layout.field(control)});
    const replacement = root.createElement('span');
    replacement.textContent = savedValue;
    controls.set(replacement,{type:'value',value:savedValue,multiline});
    control.replaceWith(replacement);
  }
  if (previous && !fields.some(field => /^Previous (?:SR|sample request)$/i.test(field.label))) fields.push(previous);
  const tables = sourceTables
    .map(table => ({...parseTable(table,sectionFor(table),controls),...layout.table(table),sourceTable:tableKeys.get(table),pending:pendingTables.some(item => item.section === sectionFor(table) && item.tableId === table.id),
      ...(confirmationSources.has(table) ? {productRecovery:confirmationSources.get(table)} : {})}));
  return {title:translateChrome(text(main.querySelector('h1,h2')?.textContent)), sections, fields, tables, documents,formGroups:layout.groups,
    text:text(main.textContent), supplementaryComplete:!pendingTables.length};
}
