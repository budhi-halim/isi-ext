import { OFFLINE_SOURCES } from './offline-config.js';
import { icon } from './icons.js';
import { includedOfflineDocuments } from './offline-document-policy.js';
import { prepareOfflineDetail, offlineLabel } from './offline-detail-presentation.js';
import { readOnlyValue, selectionMark } from './offline-record-controls.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const dateTime = value => value ? new Date(value).toLocaleString() : 'Not saved yet';

function fieldGrid(fields) {
  const list = node('dl',null,'offline-record-fields');
  for (const field of fields) {
    const group = node('div',null,'offline-record-field');
    if (field.multiline) group.classList.add('offline-record-field--wide');
    if (field.inline) group.classList.add('offline-record-field--inline');
    if (field.options) group.classList.add('offline-record-field--options');
    if (field.inlineChoices) group.classList.add('offline-record-field--inline-options');
    const value = readOnlyValue(field);
    group.append(node('dt',field.label),value);
    list.append(group);
  }
  return list;
}

function nativeForm(fields, tables, groups) {
  const layout = node('div',null,'offline-native-form');
  const entries = [...fields.map(field => ({field,...field})),...tables.map(table => ({table,...table}))]
    .sort((a,b) => (a.sourceOrder ?? Infinity)-(b.sourceOrder ?? Infinity));
  const known = new Set(groups.map(group => group.id));
  for (const group of [...groups,{id:'',title:''}]) {
    const members = entries.filter(entry => group.id ? entry.sourceGroup === group.id : !known.has(entry.sourceGroup));
    if (!members.length) continue;
    const card = node('section',null,'isi-card offline-record-section offline-native-group');
    if (group.halfWidth) card.classList.add('offline-native-group--half');
    const title = offlineLabel(group.title);
    card.setAttribute('aria-label',title || 'Saved record details');
    if (title && !(members.length === 1 && members[0].field?.label === title)) card.append(node('h2',title));
    let pendingFields = [];
    function appendFields() {
      if (pendingFields.length) card.append(fieldGrid(pendingFields));
      pendingFields = [];
    }
    for (const member of members) {
      if (member.field) pendingFields.push(member.field);
      else { appendFields(); card.append(savedTable(member.table)); }
    }
    appendFields(); layout.append(card);
  }
  return layout;
}

function savedTable(saved) {
  const section = node('section',null,'offline-record-table');
  if (saved.title && saved.title !== 'Record information') section.append(node('h3',saved.title));
  if (saved.pending) section.append(node('p','This table has not been saved. The live portal loads it separately; an empty saved table does not mean there are no entries.','isi-notice'));
  if (saved.productRecovery?.state === 'reconstructed') {
    const sheet = saved.productRecovery.sheetFields;
    const information = sheet
      ? ` Available quantities and descriptions recovered from the matching Sample sheet, saved ${dateTime(sheet.capturedAt)}. Any remaining “Not captured” cells are still unavailable, including R&D remarks and raw material status.`
      : ' Confirmation quantities, descriptions, R&D remarks and raw material status were not captured.';
    section.append(node('p',`Product names and codes recovered from ${saved.productRecovery.sources.join(' and ')}${saved.productRecovery.corroborated ? ' and matched against Sample receipt' : ''}.${information}`,'isi-notice'));
  }
  if (saved.productRecovery?.state === 'conflict') section.append(node('p',
    'The saved R&D-issued samples and Sample receipt contain different products. Confirmation rows could not be reconstructed. Check this request in the live portal.','isi-notice'));
  if (saved.productRecovery?.state === 'expected-empty') section.append(node('p',
    saved.productRecovery.status === 'PROCESS RND' ? 'Awaiting R&D. No issued product is available in this saved request yet.'
      : `No issued product is available in this saved ${saved.productRecovery.status === 'DRAFT' ? 'draft' : 'cancelled'} request.`, 'isi-notice'));
  const scroller = node('div',null,'offline-detail-table'); scroller.tabIndex = 0;
  if (saved.formLayout) scroller.classList.add('offline-detail-table--form');
  scroller.setAttribute('aria-label',saved.title || 'Saved record table');
  const table = node('table');
  const head = node('thead'), body = node('tbody');
  saved.rows.forEach((cells,index) => {
    const isHeader = index < (saved.headerRows || 0);
    const row = node('tr');
    for (const [column,value] of cells.entries()) {
      const isRowHeader = !isHeader && saved.rowHeaders?.[index]?.[column] === true;
      const cell = node(isHeader || isRowHeader ? 'th' : 'td',value);
      const parts = saved.cellParts?.[index]?.[column];
      if (parts?.some(part => part.type === 'choice' || part.type === 'value')) {
        cell.replaceChildren();
        for (const part of parts) {
          if (part.type === 'text') cell.append(document.createTextNode(part.value));
          else if (part.type === 'value') {
            const value = node('span',part.value,'offline-field-value offline-table-value');
            if (part.multiline) value.classList.add('offline-table-value--multiline');
            cell.append(value);
          }
          else if (part.type === 'choice' && ['checkbox','radio'].includes(part.kind)) {
            const mark = selectionMark(part.checked === true,part.kind === 'radio');
            mark.classList.add('offline-table-choice'); cell.append(mark);
          }
        }
      }
      if (saved.cellMultiline?.[index]?.[column]) cell.classList.add('offline-table-multiline');
      const span = saved.cellSpans?.[index]?.[column];
      if (Number.isInteger(span?.rows) && span.rows >= 0 && span.rows <= 65534) cell.rowSpan = span.rows;
      if (Number.isInteger(span?.columns) && span.columns > 0 && span.columns <= 1000) cell.colSpan = span.columns;
      if (isHeader) cell.scope = cell.colSpan > 1 ? 'colgroup' : 'col';
      else if (isRowHeader) cell.scope = cell.rowSpan > 1 ? 'rowgroup' : 'row';
      for (const nested of saved.cellTables?.[index]?.[column] || []) cell.append(savedTable(nested));
      row.append(cell);
    }
    (isHeader ? head : body).append(row);
  });
  if (head.childElementCount) table.append(head);
  table.append(body); scroller.append(table); section.append(scroller);
  return section;
}

/** Follow the native Sample usage form's question, application, commercial and product sections. */
function sampleUsage(panel, fields, tables) {
  const productLabels = new Set(['Product form','Product name','Target reference','Sample quantity']);
  const commercialLabels = new Set(['Purchase Unit Of Measures','Estimated Unit Price','Monthly potential','Estimated launch date']);
  const products = fields.filter(field => productLabels.has(field.label));
  const commercial = fields.filter(field => commercialLabels.has(field.label));
  const applications = fields.filter(field => ['Final application','Detailed application'].includes(field.label));
  const questions = fields.filter(field => !products.includes(field) && !commercial.includes(field) && !applications.includes(field));
  if (questions.length) {
    const group = fieldGrid(questions); group.classList.add('offline-record-fields--questions'); panel.append(group);
  }
  if (applications.length) {
    const group = fieldGrid(applications); group.classList.add('offline-record-applications'); panel.append(group);
  }
  if (commercial.length) {
    const group = fieldGrid(commercial); group.classList.add('offline-record-commercial'); panel.append(group);
  }
  for (const table of tables) {
    if (table.rows[0]?.includes('Manufacturer')) panel.append(node('p','Are there similar products on the market?','offline-field-heading'));
    panel.append(savedTable(table));
  }
  if (products.length) {
    const group = fieldGrid(products); group.classList.add('offline-record-fields--questions','offline-record-products'); panel.append(group);
  }
}

/** Render only inert archived data; live forms and callbacks never enter the saved page. */
export function createOfflineRecordView(container) {
  const objectUrls = new Set();
  function clear() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear(); container.replaceChildren();
  }
  function render(record, files) {
    clear();
    const source = OFFLINE_SOURCES[record.kind];
    const detail = prepareOfflineDetail(record.detail,record);
    const overview = node('section',null,detail ? 'offline-record-meta' : 'isi-card offline-record-overview');
    overview.setAttribute('aria-label','Record overview');
    const summary = source.columns.filter(column => !detail || [source.date,source.status,'sr_statkirimbarang','sr_statfeedback','tir_locked_status'].includes(column.key)).map(column => ({label:column.label,value:record.fields[column.key]}));
    overview.append(fieldGrid(summary)); container.append(overview);
    if (!detail) {
      if (source.summaryOnly) container.append(node('p','These are the totals from the last saved portal view. This summary has no individual request dates.','isi-notice'));
      else if (source.periodic) container.append(node('p','These are the saved stock values for the selected reporting month. Request dates remain separate from the reporting period.','isi-notice'));
      else if (source.stockRows && !record.detailUrl) container.append(node('p','The saved stock row has no linked sales orders.','isi-notice'));
      else if (record.kind !== 'products') container.append(node('p','Only list information is saved for this record. Detailed information will appear after it has been downloaded.','isi-notice'));
      return;
    }
    container.append(node('p','Saved fields and tables are read only. Sections that the live portal loads separately may not be included.','isi-muted'));
    if (detail.supplementaryComplete === false) container.append(node('p','Some separately loaded tables are missing from this saved copy. Other saved details and documents remain available.','isi-notice'));
    const commonFields = detail.fields.filter(field => !field.section);
    const commonTables = detail.tables.filter(table => !table.section);
    const form = record.kind === 'sample' ? node('section',null,'isi-card offline-record-section offline-record-form') : container;
    if (form !== container) { form.setAttribute('aria-label','Saved Sample Request'); container.append(form); }
    if (['tir','delivery','sales'].includes(record.kind) && detail.formGroups?.length) {
      form.append(nativeForm(commonFields,commonTables,detail.formGroups));
    } else if (commonFields.length || commonTables.length) {
      const card = node('section',null,form === container ? 'isi-card offline-record-section' : 'offline-record-identity-section');
      card.setAttribute('aria-label','Saved record details');
      if (commonFields.length) {
        const identity = fieldGrid(commonFields);
        if (record.kind === 'sample') identity.classList.add('offline-record-identity');
        card.append(identity);
      }
      for (const table of commonTables) card.append(savedTable(table));
      form.append(card);
    }
    if (detail.sections?.length) {
      const tablist = node('div',null,'offline-record-tabs');
      tablist.setAttribute('role','tablist'); tablist.setAttribute('aria-label','Record sections');
      const panels = node('div',null,'offline-record-panels');
      const buttons = [], regions = [];
      function select(index, focus = false) {
        buttons.forEach((button,position) => {
          button.setAttribute('aria-selected',String(position === index)); button.tabIndex = position === index ? 0 : -1;
          regions[position].hidden = position !== index;
        });
        if (focus) buttons[index].focus();
      }
      detail.sections.forEach((section,index) => {
        const button = node('button',section.title); button.type = 'button'; button.id = `saved-tab-${index}`;
        button.setAttribute('role','tab'); button.setAttribute('aria-controls',`saved-panel-${index}`);
        const panel = node('section',null,'isi-card offline-record-section'); panel.id = `saved-panel-${index}`;
        panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',button.id); panel.tabIndex = 0;
        const fields = detail.fields.filter(field => field.section === section.id);
        const tables = detail.tables.filter(table => table.section === section.id);
        if (record.kind === 'sample' && fields.some(field => field.label === 'Reason for this product request')) sampleUsage(panel,fields,tables);
        else {
          if (fields.length) panel.append(fieldGrid(fields));
          for (const table of tables) panel.append(savedTable(table));
        }
        if (!fields.length && !tables.length) panel.append(node('p','No fields or tables were saved for this section.','isi-muted'));
        button.addEventListener('click',() => select(index));
        button.addEventListener('keydown',event => {
          const next = event.key === 'ArrowRight' ? (index+1)%buttons.length : event.key === 'ArrowLeft' ? (index+buttons.length-1)%buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : null;
          if (next !== null) { event.preventDefault(); select(next,true); }
        });
        buttons.push(button); regions.push(panel); tablist.append(button); panels.append(panel);
      });
      select(0); form.append(tablist,panels);
    }
    const documents = includedOfflineDocuments(detail.documents);
    if (documents.length) {
      const section = node('section',null,'isi-card offline-record-section'); section.append(node('h2','Documents'));
      for (const document of documents) {
        const line = node('div',null,'offline-file'); line.append(node('span',document.label));
        const file = files.find(file => file.url === document.url);
        if (file?.blob) {
          const fileLabel = {'delivery-order-sheet':'Download saved order sheet','sample-request-sheet':'Download saved sample sheet'}[document.format] || 'Download saved file';
          const link = node('a',null,'isi-button'); link.append(icon('download'),node('span',fileLabel));
          link.href = URL.createObjectURL(file.blob); objectUrls.add(link.href); link.download = file.filename || 'document';
          line.append(node('small',`Saved ${dateTime(file.savedAt)}`),link);
        } else line.append(node('span','File not saved yet','isi-muted'));
        section.append(line);
      }
      container.append(section);
    }
    const listInformation = node('details',null,'offline-saved-text');
    listInformation.append(node('summary','List information'),fieldGrid(Object.entries(record.fields)
      .filter(([key]) => !/^(id|.*_id|view\d*)$/.test(key))
      .map(([key,value]) => ({label:source.columns.find(column => column.key === key)?.label || offlineLabel(key),value}))));
    container.append(listInformation);
    const full = node('details',null,'offline-saved-text'); full.append(node('summary','All saved text'),node('p',detail.text)); container.append(full);
  }
  return {render,clear};
}
