import {portalPath} from './save-contract.js';
import {createImprovementLoading} from './improvement-loading.js';

const handledDocuments = new WeakSet();

export function improvementSource(value) {
  const url = new URL(value);
  const route = portalPath(url.pathname);
  const source = route === '/islandsun/samplerequest/getimprovement' ? url.searchParams.get('sr_id')
    : route === '/islandsun/samplerequest/add' && url.searchParams.get('srtype') === '5' ? url.searchParams.get('improveid') : null;
  return /^[1-9]\d*$/.test(source) ? source : null;
}

/** Invoke the native population action once, without replaying over restored or edited data. */
export function createImprovementPrefill(options) {
  const source = improvementSource(location.href);
  const loading = source ? createImprovementLoading(options) : null;
  const events = new AbortController();
  let stopped = !source || handledDocuments.has(document);
  function stop() {
    stopped = true;
    handledDocuments.add(document);
    events.abort();
  }
  function userInput(event) {
    if (event.isTrusted && event.target.closest('form')) stop();
  }
  function enhance() {
    if (stopped || document.readyState !== 'complete') return;
    const actions = [...document.querySelectorAll('a[onclick],button[onclick]')]
      .filter(action => /^\s*LoadSrf\(\s*\)\s*;?\s*$/.test(action.getAttribute('onclick')));
    if (actions.length !== 1) return;
    const action = actions[0], form = action.closest('form');
    if (!form || action.matches(':disabled') || !action.getClientRects().length) return;
    const references = [...form.querySelectorAll('select')].filter(select => select.value === source);
    if (references.length !== 1) return;
    const restored = [...form.querySelectorAll('textarea,input:not([type]),input[type="text"]')]
      .some(control => {
        // Native startup fills Indonesia for Local before any previous request is loaded.
        const defaultCountry = control.id === 'sr_negara' && control.defaultValue === ''
          && control.value === 'Indonesia' && form.querySelector('#foodregulation')?.value === 'Local';
        return !defaultCountry && !control.closest('.modal,[data-isi-auto-date],[data-isi-owned]')
          && control.value !== control.defaultValue;
      });
    const populated = form.querySelector('#sp_primary_reason')?.value.trim()
      || form.querySelector('#sr_customer_id')?.value && form.querySelector('#sr_customer_id')?.value !== '0'
      || [...form.querySelectorAll('#tableSP tbody tr')].some(row => row.cells.length > 1 && row.textContent.trim());
    if (restored || populated) { stop(); return; }
    stop();
    action.click();
  }
  if (!stopped) {
    document.addEventListener('input', userInput, {capture: true, signal: events.signal});
    document.addEventListener('change', userInput, {capture: true, signal: events.signal});
    document.addEventListener('click', event => {
      if (event.isTrusted && event.target.closest('a[onclick],button[onclick]')?.getAttribute('onclick')?.includes('LoadSrf')) stop();
    }, {capture: true, signal: events.signal});
    window.addEventListener('load', enhance, {once: true, signal: events.signal});
    window.addEventListener('pagehide', stop, {once: true, signal: events.signal});
  }
  return {enhance, destroy() { stop(); loading?.destroy(); }};
}
