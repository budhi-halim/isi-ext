(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81'
    || !/\/samplerequest\/add\/?$/i.test(location.pathname)) return;
  const { earliestDate } = window[Symbol.for('islandsun.date-selection')];
  const { calendarFor, missingDeliveryStart } = window[Symbol.for('islandsun.calendar-widget')];
  const fields = ['srd_datesample', 'srd_extdatepurchase'];
  const owned = new Map();
  let timer = 0;
  let retry = 0;
  let busy = false;
  let suspended = false;
  let observer;

  function enabled() {
    return !suspended && document.documentElement.dataset.isiPortal === 'enabled';
  }

  function restore(input, state) {
    state.group.hidden = state.hidden;
    state.group.removeAttribute('data-isi-auto-date');
    delete input.dataset.isiCalendarDate;
    delete input.dataset.isiCalendarValue;
    // Do not overwrite a value subsequently supplied by the user or portal.
    if (input.value === state.last) {
      input.value = state.original;
      calendarFor(input)?.refresh();
    }
    owned.delete(input);
  }

  function synchronize() {
    if (busy || !enabled()) return false;
    const $ = window.jQuery;
    if (!$?.fn?.datepicker) return false;
    busy = true;
    let ready = true;
    let delivery = null;
    try {
      for (const name of fields) {
        const input = document.querySelector(`input[name="${name}"]`);
        if (!input) continue;
        if (input.disabled || input.readOnly) {
          if (owned.has(input)) restore(input, owned.get(input));
          continue;
        }
        const group = input.closest('.form-group');
        const picker = calendarFor(input);
        if (!group || !picker) { ready = false; continue; }
        const state = owned.get(input);
        let start = picker.start();
        if (!Number.isFinite(start) && name === 'srd_datesample') start = missingDeliveryStart(input) ?? start;
        // The live picker is authoritative, including portal reinitialization and exclusions.
        const candidate = earliestDate({
          start, end: picker.end(),
          after: name === 'srd_extdatepurchase' && delivery ? delivery.valueOf() : -Infinity,
          allowed: picker.allowed,
        });
        if (!candidate) {
          if (state) restore(input, state);
          if (name === 'srd_datesample') delivery = picker.date();
          continue;
        }
        const current = state || { group, hidden: group.hidden, original: input.value, last: null };
        if (state && input.value !== state.last) current.original = input.value;
        if (!input.value || picker.date()?.valueOf() !== candidate.valueOf()
          || input.value !== picker.format()) {
          picker.set(candidate);
        }
        if (!input.value || picker.date()?.valueOf() !== candidate.valueOf()) {
          if (state) restore(input, state);
          continue;
        }
        current.last = input.value;
        input.dataset.isiCalendarDate = candidate.toISOString().slice(0,10);
        input.dataset.isiCalendarValue = input.value;
        owned.set(input, current);
        group.hidden = true;
        group.setAttribute('data-isi-auto-date', '');
        if (name === 'srd_datesample') delivery = candidate;
      }
    } catch (error) {
      // A changed portal widget must leave its date controls usable.
      for (const [input, state] of owned) restore(input, state);
      console.warn('Islandsun could not apply the sample calendar limits.', error);
    } finally { busy = false; }
    return ready;
  }

  function schedule() {
    clearTimeout(timer);
    if (!enabled()) return;
    timer = setTimeout(() => {
      timer = 0;
      if (!synchronize() && retry++ < 20) schedule();
    }, 150);
  }

  function refresh() {
    retry = 0;
    if (enabled()) schedule();
    else {
      clearTimeout(timer);
      timer = 0;
      for (const [input, state] of owned) restore(input, state);
    }
  }

  function beforeInteraction(event) {
    if (!enabled()) return;
    if (event.type === 'click' && !event.target.closest('button, a, input[type="submit"]')) return;
    synchronize();
    // Native add/reset handlers clear product fields without dispatching change events.
    schedule();
  }

  function start() {
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-isi-portal'] });
    for (const type of ['click', 'submit', 'reset', 'change']) document.addEventListener(type, beforeInteraction, true);
    refresh();
  }
  window.addEventListener('pagehide', () => {
    suspended = true;
    clearTimeout(timer);
    observer?.disconnect();
    for (const type of ['click', 'submit', 'reset', 'change']) document.removeEventListener(type, beforeInteraction, true);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { suspended = false; start(); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
