import { translateChrome } from './logic.js';

function fieldName(control) {
  if (control.id === 'tir_tujuan') return 'Destination';
  const label = [...(control.labels || [])].map(node => node.textContent.trim()).find(Boolean)
    || control.closest('.form-group')?.querySelector('label')?.textContent.trim();
  return translateChrome(label || control.getAttribute('aria-label') || control.getAttribute('placeholder') || 'This field').replace(/\s*[:*]+\s*$/, '');
}

function focusTarget(control) {
  if (!control) return null;
  if (control.hasAttribute('data-isi-tir-destination')) return control.parentElement?.querySelector('.isi-tir-source input');
  const widget = control.nextElementSibling;
  return widget?.matches('.select2-container') ? widget.querySelector('[role="combobox"]') : control;
}

/** Present native constraint failures without changing the portal's validation rules. */
export function createFormValidation(dialogs) {
  const events = new AbortController(), invalid = new Set();
  let scheduled = false, showing = false, disposed = false;
  function warn(message, control) {
    if (showing) return;
    showing = true;
    dialogs.ask({title:'Check required information', message, action:null}).finally(() => {
      showing = false;
      if (!disposed && control?.isConnected) focusTarget(control)?.focus();
    });
  }
  function report() {
    scheduled = false;
    const controls = [...invalid].filter(control => control.isConnected && !control.validity.valid);
    invalid.clear();
    if (disposed || showing || !controls.length) return;
    const first = controls[0], name = fieldName(first);
    const message = first.validity.valueMissing ? `${name} is required.`
      : first.validity.typeMismatch ? `Enter a valid ${name.toLowerCase()}.`
        : `${name}: ${first.validationMessage}`;
    showing = true;
    dialogs.ask({title: 'Check required information', message, action: null}).finally(() => {
      showing = false;
      if (!disposed && first.isConnected) focusTarget(first)?.focus();
    });
  }
  document.addEventListener('invalid', event => {
    const control = event.target;
    if (!control.closest('.content-wrapper form') || !control.validity) return;
    event.preventDefault();
    invalid.add(control);
    if (!scheduled) { scheduled = true; queueMicrotask(report); }
  }, {capture: true, signal: events.signal});
  document.addEventListener('islandsun-before-save', event => {
    const form = event.target.closest('form');
    if (!form?.closest('.content-wrapper')) return;
    if (!form.checkValidity()) { event.preventDefault(); return; }
    if (form.querySelector('#tir_customer_id') && form.querySelector('.technical_check')) {
      const selected = form.querySelector('.technical_check input[type="checkbox"]:checked');
      const other = form.querySelector('#txt-others-technicalinformation');
      const customer = form.querySelector('#tir_customer_id');
      const coa = form.querySelector('#coa_check');
      const missingCoa = coa?.checked ? ['#coa_tanggal_kirim','#coa_dank_name','#coa_quantity']
        .map(selector => form.querySelector(selector)).find(control => control && !control.value.trim()) : null;
      const message = !selected && !other?.value.trim() ? 'Select the technical information to request.'
        : !customer.value ? 'Customer is required.' : missingCoa ? `${fieldName(missingCoa)} is required.` : null;
      if (message) {
        event.preventDefault();
        warn(message, missingCoa || (!customer.value ? customer : form.querySelector('.technical_check input')));
      }
      return;
    }
    // These are the Special Request's native pre-save checks, before its confirmation.
    if (!/\/samplerequest\/processAddSampleRequestNew\/?$/i.test(new URL(form.action).pathname) || !form.querySelector('#nameofproduct')) return;
    const groups = ['.detaildata_kat1','.detaildata_kat2','.finalaplication_list'];
    const missing = groups.find(selector => form.querySelector(selector) && !form.querySelector(`${selector} input:checked`));
    const required = ['#sr_negara','#sp_primary_reason','#sr_unitmeasure','#sr_unitprice','#txt-first-order','#txt-date-of-sample','#productforms','#nameofproduct','#targetreference','#qtys','#qtyberat'];
    const control = required.map(selector => form.querySelector(selector)).find(node => node && !node.disabled && !node.value.trim());
    const message = missing ? missing === '.finalaplication_list' ? 'Select a final application.' : 'Select a product type and product application.'
      : control ? `${fieldName(control)} is required.` : null;
    if (!message) return;
    event.preventDefault();
    if (showing) return;
    showing = true;
    dialogs.ask({title:'Check required information', message, action:null}).finally(() => {
      showing = false;
      if (!disposed) focusTarget(control || form.querySelector(`${missing} input`))?.focus();
    });
  }, {signal: events.signal});
  return {destroy() { disposed = true; events.abort(); invalid.clear(); }};
}
