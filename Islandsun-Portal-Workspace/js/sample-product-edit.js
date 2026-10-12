const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function productEditorValues(row) {
  const headers = [...row.closest('table').querySelectorAll('thead th')].map(cell => clean(cell.textContent).toLowerCase());
  const read = pattern => {
    const index = headers.findIndex(label => pattern.test(label));
    return index < 0 ? null : row.cells[index]?.textContent.trim();
  };
  const code = read(/^(?:product|produk) code$/);
  const quantity = clean(read(/^sample qty$/)).match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(g|gr|gram|kg|ml|l|pcs)$/i);
  const description = read(/^(?:description|desription)$/);
  const prices = {
    idealprice: read(/^(?:price ideal|ideal price|requested price)$/),
    pricecompetitor: read(/^(?:price competitor|competitor price)$/),
    marketingprice: read(/^marketing price$/),
  };
  if (!code || !quantity || description === null || Object.values(prices).some(value => value == null)) return null;
  const unit = /^(g|gr|gram)$/i.test(quantity[3]) ? 'GRAM' : quantity[3].toUpperCase();
  return { code, values: { qty: quantity[1], qtyberat: quantity[2], sel_uom: unit, ...prices, description } };
}

/** Native cart variants pass incompatible edit arguments; the clicked row remains authoritative. */
export function createSampleProductEdit() {
  const events = new AbortController();
  let sequence = 0, timer;
  document.addEventListener('click', event => {
    if (!/^\/islandsun\/(?:index\.php\/)?samplerequest(?:\/|$)/i.test(location.pathname)) return;
    const button = event.target.closest?.('#tableSP button[onclick],#tableSP a[onclick]');
    if (!/^\s*updateRowC\s*\(/.test(button?.getAttribute('onclick') || '')) return;
    clearTimeout(timer);
    const row = button.closest('tr'), snapshot = productEditorValues(row), current = ++sequence;
    if (!snapshot) return;
    timer = setTimeout(() => {
      if (events.signal.aborted || current !== sequence || !row.isConnected) return;
      const modal = document.querySelector('#modalProduk.in');
      const product = modal?.querySelector('#produkid');
      const selectedCode = clean(product?.selectedOptions[0]?.textContent.split('/')[0]);
      if (selectedCode !== clean(snapshot.code)) return;
      const controls = Object.keys(snapshot.values).map(id => modal.querySelector(`#${id}`));
      if (controls.some(control => !control || control.disabled)) return;
      const unit = modal.querySelector('#sel_uom');
      if (![...unit.options].some(option => option.value === snapshot.values.sel_uom)) return;
      for (const control of controls) {
        control.value = snapshot.values[control.id];
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 0);
  }, { capture: true, signal: events.signal });
  return { destroy() { events.abort(); clearTimeout(timer); sequence++; } };
}
