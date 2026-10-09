import { isTirForm } from './tir-page.js';
import { translateChrome } from './logic.js';

function translateDuplicateWarning(form) {
  if (!form) return;
  const walker = document.createTreeWalker(form, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/^\s*WARNING!+\s*(SRF|SRS) ini sudah dibuat TIR sebanyak/i.test(node.textContent)
      || node.parentElement.closest('textarea,script,style,[contenteditable],[data-isi-owned]')) continue;
    const translated = translateChrome(node.textContent);
    if (translated !== node.textContent.trim()) node.textContent = translated;
  }
}

/** Present native TIR fields without replacing their values or change handlers. */
export function createTirForm() {
  const events = new AbortController();
  let source, group, destination, destinations, resetTimer;
  function sync() {
    if (!source || !group) return;
    for (const radio of group.querySelectorAll('input')) {
      radio.checked = radio.value === source.value;
      radio.disabled = source.disabled;
    }
    if (destination && destinations) for (const checkbox of destinations.querySelectorAll('input')) {
      checkbox.checked = destination.value === checkbox.value || destination.value === 'all';
      checkbox.disabled = destination.disabled;
    }
  }
  function enhance() {
    if (!isTirForm()) return;
    const cancel = document.querySelector('#btn-cancel-lock');
    if (cancel && !cancel.textContent.trim() && !cancel.getAttribute('aria-label')) cancel.setAttribute('aria-label', 'Cancel editing');
    source = document.querySelector('#tir_jenis');
    if (!source) return;
    translateDuplicateWarning(source.form);
    const column = source.closest('.box')?.parentElement;
    if (column?.matches('[class*="col-"]')) column.dataset.isiTirColumn = '';
    const technical = document.querySelector('.technical_check');
    if (technical) technical.dataset.isiTechnicalChoices = '';
    const others = document.querySelector('#txt-others-technicalinformation');
    const row = others?.closest('.row');
    if (row) {
      row.dataset.isiTechnicalOther = '';
      const check = row.querySelector('input[type="checkbox"]');
      const label = row.querySelector('label');
      if (check && label) {
        if (!check.id) check.id = 'isi-tir-other';
        label.htmlFor = check.id;
      }
      others.setAttribute('aria-label', 'Other technical information');
    }
    if (!group?.isConnected) {
      group = document.createElement('fieldset'); group.dataset.isiOwned = ''; group.className = 'isi-tir-source';
      const legend = document.createElement('legend'); legend.className = 'isi-visually-hidden'; legend.textContent = 'Data type'; group.append(legend);
      for (const value of ['Sample Request', 'Stock Request']) {
        if (![...source.options].some(option => option.value === value)) continue;
        const label = document.createElement('label');
        const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'isi-tir-source'; radio.value = value;
        radio.setAttribute('form', '');
        const text = document.createElement('span'); text.textContent = value;
        label.append(radio, text); group.append(label);
      }
      source.dataset.isiTirSource = '';
      source.after(group);
      group.addEventListener('change', event => {
        if (!event.target.matches('input:checked') || source.disabled || source.value === event.target.value) return;
        source.value = event.target.value;
        source.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      }, { signal: events.signal });
      source.addEventListener('change', sync, { signal: events.signal });
      source.form?.addEventListener('reset', () => {
        clearTimeout(resetTimer);
        // Native control values reset after the reset event's listeners finish.
        resetTimer = setTimeout(() => { if (!events.signal.aborted) { defaultSource(); sync(); } },0);
      }, { signal: events.signal });
      // Native change handlers can replace catalogs; those mutations are not presentation edits to restore.
      queueMicrotask(() => {
        if (!events.signal.aborted && source?.isConnected) { defaultSource(); sync(); }
      });
    }
    destination = document.querySelector('#tir_tujuan');
    if (destination && !destinations?.isConnected && ['30','35','all'].every(value => [...destination.options].some(option => option.value === value))) {
      destinations = document.createElement('fieldset');
      destinations.dataset.isiOwned = ''; destinations.className = 'isi-tir-source';
      const legend = document.createElement('legend'); legend.className = 'isi-visually-hidden'; legend.textContent = 'Destination';
      destinations.append(legend);
      for (const [value, name] of [['30','R&D'],['35','QA / QC']]) {
        const label = document.createElement('label');
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = value; input.setAttribute('form', '');
        const text = document.createElement('span'); text.textContent = name;
        label.append(input, text); destinations.append(label);
      }
      destination.dataset.isiTirDestination = '';
      destination.after(destinations);
      destinations.addEventListener('change', () => {
        if (destination.disabled) { sync(); return; }
        const chosen = [...destinations.querySelectorAll('input:checked')].map(input => input.value);
        destination.value = chosen.length === 2 ? 'all' : chosen[0] || '';
        destination.dispatchEvent(new Event('change', { bubbles: true })); sync();
      }, { signal: events.signal });
      destination.addEventListener('change', sync, { signal: events.signal });
      destination.addEventListener('invalid', () => destinations.querySelector('input')?.focus(), { signal: events.signal });
    }
    sync();
  }
  function defaultSource() {
    if (!/\/create\/?$/i.test(location.pathname) || !['-',''].includes(source.value) || source.disabled) return;
    if (![...source.options].some(option => option.value === 'Sample Request')) return;
    source.value = 'Sample Request';
    source.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { enhance, destroy() { events.abort(); clearTimeout(resetTimer); group?.remove(); destinations?.remove(); } };
}
