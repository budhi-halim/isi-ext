import { SAMPLE_APPLICATION_GROUPS } from './sample-application-groups.js';
import { presentSampleQuantities } from './sample-quantity.js';
import { createSampleProductEdit } from './sample-product-edit.js';

const QUANTITY_UNITS = 'select[name="srd_fo_uom"],select[name="srd_avg_uom"],select[name="srd_max_uom"]';

export function createSampleFormControls() {
  const units = new Map();
  const productEdit = createSampleProductEdit();

  function arrange() {
    presentSampleQuantities(document.body);
    if (/^\/islandsun\/(?:index\.php\/)?samplerequest(?:\/|$)/i.test(location.pathname)) {
      const price = document.querySelector('#modalProduk [name="marketingprice"]');
      if (price?.closest('.form-group')) price.closest('.form-group').dataset.isiMarketingPrice = '';
      const form = document.querySelector('#sr_customer_id')?.closest('form');
      if (form) form.dataset.isiSampleForm = '';
      const potential = document.querySelector('#txt-first-order')?.closest('table');
      if (potential?.querySelector('#txt-avg') && potential.querySelector('#txt-max') && !potential.hasAttribute('data-isi-sample-potential')) {
        const row = potential.rows[0];
        if (potential.rows.length === 1 && row.cells.length === 9) {
          potential.dataset.isiSamplePotential = '';
          potential.setAttribute('role', 'presentation');
          for (let index = 0; index < 3; index++) {
            const label = row.cells[index * 3].querySelector('h5');
            const input = row.cells[index * 3 + 1].querySelector('input');
            const unit = row.cells[index * 3 + 2].querySelector('select');
            if (!label || !input || !unit) continue;
            label.id ||= `isi-potential-label-${index}`;
            input.setAttribute('aria-labelledby', label.id);
            unit.setAttribute('aria-label', `${label.textContent.trim()} unit`);
          }
        }
      }
      const addProduct = document.querySelector('#btn-mop');
      if (addProduct) addProduct.parentElement.dataset.isiProductToolbar = '';
      const products = document.querySelector('#tableSP');
      if (products && !products.parentElement.hasAttribute('data-isi-sample-products')) {
        const scroll = document.createElement('div');
        scroll.dataset.isiSampleProducts = '';
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', 'Requested products');
        scroll.tabIndex = 0;
        products.before(scroll);
        scroll.append(products);
      }
      const preview = document.querySelector('#modal-produk-masuk');
      if (preview) {
        preview.setAttribute('aria-label', 'Review products');
        preview.querySelector('.close')?.setAttribute('aria-label', 'Close product review');
        const header = preview.querySelector('.modal-header');
        if (header && !header.querySelector('h2,h3,h4')) {
          const heading = document.createElement('h3');
          heading.textContent = 'Review products';
          header.prepend(heading);
        }
        const table = preview.querySelector('#body-produk-masuk table');
        if (table && !table.parentElement.hasAttribute('data-isi-product-review-table')) {
          const scroll = document.createElement('div');
          scroll.dataset.isiProductReviewTable = '';
          scroll.setAttribute('role', 'region');
          scroll.setAttribute('aria-label', 'Products to save');
          scroll.tabIndex = 0;
          table.before(scroll);
          scroll.append(table);
        }
      }
      document.querySelector('#detailsamefunction')?.closest('.row')?.setAttribute('data-isi-same-function', '');
      document.querySelector('#sr_unitmeasure')?.closest('.row')?.setAttribute('data-isi-sample-commercial', '');
      for (const control of document.querySelectorAll('#productforms,#nameofproduct,#targetreference,#qtys')) {
        const row = control.closest('.row');
        if (!row) continue;
        row.dataset.isiSampleProductRow = '';
        if (control.id === 'qtys' && !row.querySelector('[data-isi-sample-quantity]')) {
          const columns = [...row.children].filter(child => child.matches('[class*="col-"]'));
          const group = document.createElement('div'); group.dataset.isiSampleQuantity = '';
          row.append(group);
          for (const column of columns.slice(1)) group.append(column);
        }
      }
      for (const tabs of document.querySelectorAll('.nav-tabs,#tab > .btn-group[data-toggle="buttons"]')) {
        const links = [...tabs.querySelectorAll(':scope > li > a,:scope > a[data-toggle="tab"]')];
        if (links.length === 1) {
          tabs.dataset.isiSingleSection = '';
          for (const link of links) {
            link.removeAttribute('href');
            link.removeAttribute('data-toggle');
            link.removeAttribute('role');
            link.removeAttribute('tabindex');
          }
        }
      }
      for (const note of document.querySelectorAll('.panel-body > i,.panel-body > small,.panel-body > p,.box-body > i,.box-body > small,.box-body > p')) {
        const text = note.textContent.replace(/\s+/g, ' ').trim();
        if (!note.childElementCount && /^\*?\s*(?:semua field wajib di\s*isi+|all fields are required)[.!]?$/i.test(text)) note.hidden = true;
      }
    }
    for (const row of document.querySelectorAll('.detaildata')) {
      if (row.hasAttribute('data-isi-application-groups')) continue;
      const columns = [...row.children];
      const sections = SAMPLE_APPLICATION_GROUPS.map(section => ({ ...section, columns: columns.filter(column => column.matches(section.selector)) }));
      if (sections.some(section => !section.columns.length) || sections.flatMap(section => section.columns).length !== columns.length) continue;
      row.setAttribute('data-isi-application-groups', '');
      for (const section of sections) {
        const group = document.createElement('section');
        group.className = 'isi-application-group';
        group.setAttribute('aria-label', section.name);
        const heading = document.createElement('h4');
        heading.textContent = section.name;
        const hint = document.createElement('p');
        hint.className = 'isi-application-group__hint';
        hint.textContent = section.required ? 'Select at least one' : 'Optional';
        group.append(heading, hint);
        row.append(group);
        // Original category containers and controls remain available to native validation.
        for (const column of section.columns) group.append(column);
        if (!section.required) for (const hint of group.querySelectorAll('small')) {
          if (/only for flavour.*mandatory/i.test(hint.textContent)) hint.hidden = true;
        }
      }
    }
  }

  function enhanceUnits() {
    if (!/^\/islandsun\/(?:index\.php\/)?samplerequest\/add\/?$/i.test(location.pathname)) return;
    for (const [select, entry] of units) if (!select.isConnected) { select.removeEventListener('change', entry.change); units.delete(select); }
    for (const select of document.querySelectorAll(QUANTITY_UNITS)) {
      if (units.has(select)) continue;
      const kg = [...select.options].find(option => option.value.toUpperCase() === 'KG' && !option.disabled);
      if (!kg) continue;
      const entry = { value: select.value, defaults: [...select.options].map(option => [option, option.defaultSelected]), changed: false };
      entry.change = () => { entry.changed = true; };
      // Preserve an existing non-default choice, including browser-restored form input.
      const nativeDefault = [...select.options].find(option => option.defaultSelected) || select.options[0];
      const untouched = select.value === nativeDefault?.value;
      for (const option of select.options) option.defaultSelected = option === kg;
      if (untouched && ['', 'CASES', 'KG'].includes(entry.value.toUpperCase())) select.value = kg.value;
      else select.value = entry.value;
      select.addEventListener('change', entry.change);
      units.set(select, entry);
    }
  }

  return {
    arrange,
    enhanceUnits,
    destroy() {
      productEdit.destroy();
      for (const [select, entry] of units) {
        select.removeEventListener('change', entry.change);
        const value = select.value;
        for (const [option, selected] of entry.defaults) option.defaultSelected = selected;
        select.value = !entry.changed && value.toUpperCase() === 'KG' ? entry.value : value;
      }
      units.clear();
    },
  };
}
