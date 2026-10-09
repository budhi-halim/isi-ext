const element = (tag,text,className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/** Use geometry, not font glyphs, for marks that must stay centered at any zoom. */
export function selectionMark(checked, single) {
  const mark = element('span',null,'offline-choice-mark');
  mark.dataset.checked = String(checked);
  mark.dataset.kind = single ? 'radio' : 'checkbox';
  mark.setAttribute('role','img');
  mark.setAttribute('aria-label',checked ? 'Selected' : 'Not selected');
  if (checked && !single) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 20 20'); svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS(svg.namespaceURI,'path');
    path.setAttribute('d','M4.5 10.5 8 14l7.5-8');
    svg.append(path); mark.append(svg);
  }
  return mark;
}

function choiceItem(option, single, showDetail = true) {
  const item = element('div',null,'offline-choice');
  item.dataset.selected = String(option.checked);
  item.append(selectionMark(option.checked,single),element('span',option.label));
  if (showDetail && option.inlineDetail) {
    item.classList.add('offline-choice--inline-detail');
    item.append(element('span',option.detail || '—','offline-choice-detail offline-field-value'));
  } else if (showDetail && option.detail) item.append(element('span',option.detail,'offline-choice-detail'));
  return item;
}

/** Display immutable form values with the same grouping as the live Sample form. */
export function readOnlyValue(field) {
  const value = element('dd');
  if (field.reference?.kind === 'sample' && /^[1-9]\d*$/.test(field.reference.id)) {
    const link = element('a',field.value);
    link.href = `offline.html?${new URLSearchParams({kind:'sample',record:field.reference.id})}`;
    value.className = 'offline-field-reference'; value.append(link);
  } else if (field.parts) {
    value.className = 'offline-field-parts';
    for (const part of field.parts) {
      const partValue = element('span',part.value || '—','offline-field-value');
      partValue.setAttribute('aria-label',part.label); value.append(partValue);
    }
  } else if (field.options) {
    const single = field.selectionType === 'single';
    value.className = field.groups ? 'offline-application-groups' : 'offline-choice-list';
    value.dataset.selectionType = single ? 'single' : 'multiple';
    if (field.groups) {
      for (const group of field.groups) {
        const section = element('section',null,'offline-application-group');
        section.setAttribute('aria-label',group.name);
        section.append(element('h4',group.name),element('p',group.required ? 'Select at least one' : 'Optional','offline-application-hint'));
        for (const option of group.options) section.append(choiceItem(option,false));
        value.append(section);
      }
      const grouped = new Set(field.groups.flatMap(group => group.options.map(option => option.label)));
      for (const option of field.options.filter(option => !grouped.has(option.label))) value.append(choiceItem(option,false));
    } else if (single) {
      const options = element('div',null,'offline-single-options');
      for (const option of field.options) options.append(choiceItem(option,true,false));
      value.append(options);
      const selected = field.options.find(option => option.checked && option.detail);
      if (selected) value.append(element('span',selected.detail,'offline-field-value'));
    } else for (const option of field.options) value.append(choiceItem(option,false));
  } else if (['checkbox','radio'].includes(field.controlType)) {
    const checked = field.value === 'Selected';
    value.className = 'offline-field-choice';
    value.append(selectionMark(checked,field.controlType === 'radio'),element('span',field.value));
  } else {
    value.textContent = field.value === '' || field.value == null ? '—' : field.value;
    if (field.multiline) value.classList.add('offline-field-multiline');
  }
  return value;
}
