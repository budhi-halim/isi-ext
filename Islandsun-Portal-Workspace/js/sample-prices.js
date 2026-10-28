(() => {
  if (!['http://apps.islandsunindonesia.com:81', 'http://192.168.0.22:81'].includes(location.origin)
    || !/\/samplerequest\/(?:add|edit)\/?$/i.test(location.pathname)) return;
  const { samplePrice } = window[Symbol.for('islandsun.sample-price')];
  const endpoint = '/islandsun/samplerequest/getMarketingPrice';
  let $, controls, presentation, observer, timer;
  let suspended = false, open = false, attempts = 0, generation = 0;
  let request = null, state = { phase: 'idle', product: '', price: null };

  const enabled = () => !suspended && document.documentElement.dataset.isiPortal === 'enabled';
  const product = () => controls?.product.value || '';
  const writable = () => controls && !controls.ideal.disabled && !controls.ideal.readOnly && !controls.save.disabled;
  const active = () => enabled() && open && writable();

  function cancel() {
    generation++;
    const previous = request;
    request = null;
    previous?.abort();
  }

  function message() {
    if (state.phase === 'loading') return 'Checking marketing price…';
    if (state.phase === 'error') return 'Marketing price could not be checked. Try again before saving.';
    if (state.phase === 'unavailable') return 'This product has no valid marketing price and cannot be requested.';
    if (state.phase === 'ready') return state.price.ideal === '5' && Number(state.price.marketing) === 0
      ? 'Request and competitor prices: 5 per kg (marketing price is 0).'
      : 'Request and competitor prices match the marketing price.';
    return 'Select a product to check its marketing price.';
  }

  function render() {
    if (!active()) return;
    if (!presentation) {
      const group = controls.ideal.closest('.form-group');
      const target = controls.marketing.closest('.form-group');
      if (!group || !target || group === target) return;
      const status = document.createElement('div');
      status.className = 'isi-sample-price-status';
      const text = document.createElement('p');
      text.id = 'isi-sample-price-message';
      text.setAttribute('role', 'status');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry price check';
      retry.addEventListener('click', retryPrice);
      status.append(text, retry);
      target.append(status);
      const competitorGroup = controls.competitor.closest('.form-group');
      presentation = { group, hidden: group.hidden, competitorGroup, competitorHidden: competitorGroup?.hidden, status, text, retry,
        describedBy: controls.marketing.getAttribute('aria-describedby'),
        disabled: controls.save.getAttribute('aria-disabled') };
      group.hidden = true;
      group.setAttribute('data-isi-auto-price', '');
      if (competitorGroup && competitorGroup !== target) {
        competitorGroup.hidden = true;
        competitorGroup.setAttribute('data-isi-auto-price', '');
      }
      controls.marketing.setAttribute('aria-describedby', [presentation.describedBy, text.id].filter(Boolean).join(' '));
    }
    const ready = state.phase === 'ready' && state.product === product();
    controls.ideal.value = ready ? state.price.ideal : '';
    controls.competitor.value = ready ? state.price.ideal : '';
    controls.marketing.value = ready ? state.price.marketing : '';
    controls.save.setAttribute('aria-disabled', String(!ready));
    presentation.text.textContent = message();
    presentation.status.dataset.state = state.phase;
    presentation.retry.hidden = state.phase !== 'error';
  }

  function restore() {
    if (!presentation) return;
    const { group, hidden, competitorGroup, competitorHidden, status, retry, describedBy, disabled } = presentation;
    group.hidden = hidden;
    group.removeAttribute('data-isi-auto-price');
    if (competitorGroup) {
      competitorGroup.hidden = competitorHidden;
      competitorGroup.removeAttribute('data-isi-auto-price');
    }
    retry.removeEventListener('click', retryPrice);
    status.remove();
    for (const [element, name, value] of [[controls.marketing, 'aria-describedby', describedBy], [controls.save, 'aria-disabled', disabled]]) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    presentation = null;
  }

  function reset() {
    cancel();
    state = { phase: 'idle', product: '', price: null };
  }

  function retryPrice() {
    if (!active() || request || !product()) return;
    $.ajax({ url: endpoint, type: 'POST', data: { id: product() } });
  }

  function synchronize() {
    if (!active()) { restore(); return; }
    if (state.product !== product()) reset();
    if (product() && state.phase === 'idle') retryPrice();
    render();
  }

  function applyCallbacks(callbacks, context, args) {
    for (const callback of Array.isArray(callbacks) ? callbacks : [callbacks]) {
      if (typeof callback === 'function') callback.apply(context, args);
    }
  }

  function priceRequest(options, original, xhr) {
    let url;
    try { url = new URL(options.url, location.href); } catch { return; }
    if (!active() || url.origin !== location.origin || url.pathname.toLowerCase() !== endpoint.toLowerCase()) return;
    const values = typeof options.data === 'string' ? new URLSearchParams(options.data) : null;
    const id = String(values?.get('id') ?? original.data?.id ?? '');
    if (!id || id !== product()) {
      // Native cart cleanup requests product 1. It must not replace a later selection.
      xhr.abort();
      return;
    }
    cancel();
    const version = generation;
    request = xhr;
    state = { phase: 'loading', product: id, price: null };
    const success = options.success, error = options.error;
    options.timeout = Math.min(Number(options.timeout) || 15000, 15000);
    const current = () => active() && version === generation && product() === id;
    options.success = function (...args) {
      if (!current()) return;
      request = null;
      const price = samplePrice(args[0]);
      // Preserve native follow-up behavior only for the current valid response.
      if (price) applyCallbacks(success, this, args);
      if (!current()) return;
      state = { phase: price ? 'ready' : 'unavailable', product: id, price };
      render();
    };
    options.error = function (...args) {
      if (!current()) return;
      request = null;
      state = { phase: 'error', product: id, price: null };
      applyCallbacks(error, this, args);
      render();
    };
    render();
    // Row editors fill their old saved price after starting the lookup.
    queueMicrotask(() => { if (current()) render(); });
  }

  function show(event) {
    if (event.target !== controls.modal) return;
    open = true;
    reset();
    // Native row editors select the product after Bootstrap's show event.
    queueMicrotask(synchronize);
  }

  function hide(event) {
    if (event.target !== controls.modal) return;
    open = false;
    reset();
    restore();
  }

  function beforeSave(event) {
    if (!active() || !controls.save.contains(event.target)) return;
    synchronize();
    if (state.phase === 'ready' && state.product === product()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    document.dispatchEvent(new CustomEvent('islandsun-portal-notice', { detail: message() }));
    (presentation?.retry.hidden === false ? presentation.retry : controls.marketing).focus();
  }

  function refresh() {
    if (!enabled()) { reset(); restore(); return; }
    synchronize();
  }

  function connect() {
    clearTimeout(timer);
    if (suspended) return;
    $ = window.jQuery;
    if (!$?.ajaxPrefilter) {
      if (attempts++ < 30) timer = setTimeout(connect, 100);
      return;
    }
    const modal = document.querySelector('#modalProduk');
    const find = selector => modal?.querySelector(selector);
    controls = { modal, product: find('#produkid'), marketing: find('#marketingprice'), ideal: find('#idealprice'), competitor: find('#pricecompetitor'), save: find('#btn-produk') };
    if (Object.values(controls).some(value => !value)) return;
    $.ajaxPrefilter(priceRequest);
    $(modal).on('show.bs.modal.isiSamplePrice', show).on('hide.bs.modal.isiSamplePrice', hide);
    $(controls.product).on('change.isiSamplePrice', () => queueMicrotask(synchronize));
    window.addEventListener('click', beforeSave, true);
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-isi-portal'] });
    open = modal.classList.contains('in') || modal.classList.contains('show');
    refresh();
  }

  window.addEventListener('pagehide', () => {
    suspended = true;
    clearTimeout(timer);
    observer?.disconnect();
    reset();
    restore();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    suspended = false;
    if (controls) {
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-isi-portal'] });
      refresh();
    }
    else { attempts = 0; connect(); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect, { once: true });
  else connect();
})();
