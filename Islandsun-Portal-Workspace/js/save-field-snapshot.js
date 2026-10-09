function sampleNumber(text) {
  return text.trim().match(/^([1-9]\d*\/(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\/\d{4}\/SRF)(?=\s|$)/i)?.[1].toUpperCase() || null;
}

/** Resolve the Previous SR selector and its native read-only representation to one business number. */
function previousSample(form) {
  const controls = [...form.querySelectorAll('select[name="sr_previous_sr"]')];
  if (controls.length === 1) {
    const options = [...controls[0].selectedOptions];
    return options.length === 1 ? sampleNumber(options[0].textContent) : null;
  }
  if (controls.length) return null;
  const groups = [...form.querySelectorAll('.form-group')].filter(group =>
    [...group.children].some(child => child.matches('label') && /^Previous SR\s*:?$/i.test(child.textContent.trim())));
  const references = groups.flatMap(group => [...group.children].filter(child => child.matches('button')));
  return references.length === 1 ? sampleNumber(references[0].textContent) : null;
}

/** Compare business fields across the portal's create and saved-detail forms. */
export function saveFieldSnapshot(form, kind) {
  const result = {};
  const sample = kind === 'sample';
  const noEquivalent = sample && form.querySelector('input[name="sr_samefunction"][value="N"]:checked');
  for (const control of form.elements) {
    if (!control.name || !control.matches('input,select,textarea')
      || control.closest('[data-isi-owned],#modalProduk,#modal-produk-masuk')
      || sample && control.closest('.modal')
      || ['hidden', 'submit', 'button', 'reset', 'file'].includes(control.type)
      || control.name.startsWith('isi-')) continue;
    let name = control.name.replace(/^dt\[([^\]]+)\]/, '$1');
    if (sample && name === 'qtyberat2') name = 'qtyberat';
    if (sample && name === 'sr_previous_sr') {
      // An unrecognized reference must fail comparison with a returned text-only reference.
      result[name] = [previousSample(form) || `unresolved:${control.value}`];
      continue;
    }
    // The portal resets this unused selector to its first product after saving No.
    if (noEquivalent && name === 'detailsamefunction') continue;
    result[name] ||= [];
    if (['checkbox', 'radio'].includes(control.type) && !control.checked) continue;
    const calendarDate = sample && ['srd_datesample','srd_extdatepurchase'].includes(name)
      && control.dataset.isiCalendarValue === control.value && /^\d{4}-\d{2}-\d{2}$/.test(control.dataset.isiCalendarDate || '')
      ? control.dataset.isiCalendarDate : null;
    result[name].push(calendarDate || control.value.trim());
  }
  if (sample && !Object.hasOwn(result, 'sr_previous_sr')) {
    const reference = previousSample(form);
    if (reference) result.sr_previous_sr = [reference];
  }
  return result;
}
