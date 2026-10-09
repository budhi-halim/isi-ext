const clean = value => String(value || '').replace(/\s+/g,' ').trim();

/** Native forms also place labels in the column immediately before the control. */
export function siblingFieldLabel(control) {
  const row = control.closest('.row');
  if (!row || control.closest('table')) return '';
  const labels = [...row.querySelectorAll('label')].filter(label => label.closest('.row') === row);
  return labels.length === 1 ? clean(labels[0].textContent) : '';
}

/** Retain native card boundaries and field/table order without retaining executable markup. */
export function createSavedFormLayout(main, kind) {
  const active = ['tir','delivery','sales'].includes(kind);
  const order = new Map([...main.querySelectorAll('*')].map((element,index) => [element,index]));
  const groups = [], keys = new Map();
  function describe(element) {
    if (!active) return {};
    const parent = element.closest('.panel,.box') || main;
    if (!keys.has(parent)) {
      const id = `form-${groups.length}`;
      keys.set(parent,id);
      const heading = [...parent.querySelectorAll('.panel-heading,.box-header .box-title,.box-body > label,legend')]
        .find(heading => (heading.closest('.panel,.box') || main) === parent);
      const column = parent.parentElement?.closest('.col-md-6,.col-sm-6');
      groups.push({id,title:clean(heading?.textContent),halfWidth:!!column && !parent.closest('table')});
    }
    return {sourceGroup:keys.get(parent),sourceOrder:order.get(element)};
  }
  function field(control) {
    if (!active) return {};
    let choices = {};
    if (kind === 'tir' && control.tagName === 'SELECT') {
      const values = [...control.options].map(option => option.value);
      if (control.id === 'tir_jenis' && ['Sample Request','Stock Request'].includes(control.value)) {
        choices = {selectionType:'single',inlineChoices:true,
          options:['Sample Request','Stock Request'].filter(value => values.includes(value)).map(label => ({label,checked:control.value === label}))};
      } else if (control.id === 'tir_tujuan' && ['30','35','all'].every(value => values.includes(value)) && ['30','35','all'].includes(control.value)) {
        choices = {selectionType:'multiple',inlineChoices:true,
          options:[['30','R&D'],['35','QA / QC']].map(([value,label]) => ({label,checked:control.value === value || control.value === 'all'}))};
      }
    }
    return {...describe(control),sourceControl:control.id || control.name,
      inline:kind === 'delivery' && !!siblingFieldLabel(control),...choices};
  }
  return {groups,field,table:describe};
}
