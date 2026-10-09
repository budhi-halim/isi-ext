/** Native detail forms sometimes render defaults instead of their saved list values. */
export function applySavedDetailValues(root, record) {
  if (!record?.fields) return;
  const fields = record.fields;
  function selectedText(selector, value) {
    const select = root.querySelector(selector);
    if (!select || value == null || value === '') return;
    const option = root.createElement('option');
    option.textContent = String(value); option.selected = true;
    select.replaceChildren(option);
  }
  if (record.kind === 'delivery') {
    selectedText('#customer',fields.do_customer);
    selectedText('#pic',fields.do_pic_name);
  }
  if (['stock','sudden'].includes(record.kind)) {
    selectedText('select[name="dt[srs_status]"]',fields.srs_status);
  }
  if (record.kind === 'sudden') {
    for (const row of root.querySelectorAll('.content-wrapper table tr')) {
      if (row.cells[0]?.textContent.trim().toLowerCase() !== 'date') continue;
      const input = row.cells[1]?.querySelector('input:not([type="hidden"])');
      if (input && record.date) input.value = record.date;
    }
  }
}
