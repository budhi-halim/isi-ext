const FORM_ROUTES = /^\/islandsun\/(?:index\.php\/)?(?:stock[-_]request\/(?:add|add-open|add-replace)|sales[-_]order\/(?:add|edit[^/]*(?:\/\d+)?)|suddenrequest\/(?:add_sudden|edit[^/]*(?:\/\d+)?))\/?$/i;

const LEGENDS = new Map([
  ['Unit Price < Marketing Price / Currency tidak sesuai', 'Unit price below marketing price or currency mismatch'],
  ['Unit Price tidak sesuai dengan mata uang', 'Unit price does not match the selected currency'],
]);

export function createOperationalForms() {
  const observed = new Set();
  const attributes = new Map();
  function remember(element, name, value) {
    let values = attributes.get(element);
    if (!values) { values = new Map(); attributes.set(element, values); }
    if (!values.has(name)) values.set(name, element.getAttribute(name));
    if (value === null) element.removeAttribute(name);
    else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  function captureColor(element) {
    if (!(element instanceof Element)) return;
    const background = (element.style.backgroundColor || element.getAttribute('bgcolor') || '').toLowerCase().replaceAll(' ', '');
    const state = ['red','#ff0000','rgb(255,0,0)'].includes(background) ? 'price'
      : ['pink','#ffc0cb','rgb(255,192,203)'].includes(background) ? 'currency' : null;
    if (state || element.hasAttribute('data-isi-price-state')) remember(element, 'data-isi-price-state', state);
  }
  const observer = new MutationObserver(records => {
    for (const record of records) captureColor(record.target);
  });
  function enhance() {
    if (!FORM_ROUTES.test(location.pathname)) return;
    for (const element of attributes.keys()) if (!element.isConnected) attributes.delete(element);
    for (const form of document.querySelectorAll('.content form')) {
      form.dataset.isiOperationalForm = '';
      for (const element of form.querySelectorAll('[style],[bgcolor]')) captureColor(element);
      if (!observed.has(form)) { observed.add(form); observer.observe(form, {subtree:true,attributes:true,attributeFilter:['style','bgcolor']}); }
      for (const legend of form.querySelectorAll('small')) {
        const text = legend.textContent.trim().replace(/\s+/g, ' ');
        const translation = LEGENDS.get(text);
        if (translation) { legend.textContent = translation; legend.dataset.isiColorLegend = ''; }
        if (!legend.hasAttribute('data-isi-color-legend')) continue;
        const swatch = legend.previousElementSibling;
        if (swatch?.matches('label')) { swatch.dataset.isiColorSwatch = ''; swatch.setAttribute('aria-hidden', 'true'); }
        legend.parentElement.dataset.isiColorKey = '';
      }
      for (const textarea of form.querySelectorAll('textarea')) {
        if (textarea.closest('td,th')) continue;
        const row = textarea.closest('.row');
        if (row) row.dataset.isiRemarksRow = '';
      }
      for (const button of form.querySelectorAll('button,input[type="submit"]')) {
        if (!/^(save|simpan)$/i.test(button.textContent.trim() || button.value)) continue;
        const row = button.closest('.row');
        if (row && !row.querySelector('input:not([type="hidden"]),textarea,select')) row.dataset.isiStockActions = '';
        else button.parentElement.dataset.isiFormActions = '';
      }
    }
  }
  return { enhance, destroy() {
    observer.disconnect(); observed.clear();
    for (const [element, values] of attributes) for (const [name, value] of values) {
      if (value === null) element.removeAttribute(name); else element.setAttribute(name,value);
    }
    attributes.clear();
  } };
}
