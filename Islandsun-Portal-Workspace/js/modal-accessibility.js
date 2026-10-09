/** Keep the legacy modal's accessibility visibility consistent with its native open class. */
export function createModalAccessibility() {
  const owned = new Map();
  function enhance() {
    for (const modal of document.querySelectorAll('#modalProduk,#modal-produk-masuk')) {
      if (!owned.has(modal)) owned.set(modal,{original:modal.getAttribute('aria-hidden'),last:null});
      const state = owned.get(modal), hidden = String(!modal.classList.contains('in'));
      if (modal.getAttribute('aria-hidden') !== hidden) modal.setAttribute('aria-hidden',hidden);
      state.last = hidden;
    }
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target.matches('#modalProduk,#modal-produk-masuk'))) enhance();
  });
  observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});
  return {enhance,destroy() {
    observer.disconnect();
    for (const [modal,state] of owned) if (modal.getAttribute('aria-hidden') === state.last) {
      if (state.original === null) modal.removeAttribute('aria-hidden');
      else modal.setAttribute('aria-hidden',state.original);
    }
    owned.clear();
  }};
}
