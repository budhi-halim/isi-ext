/** Only numeric pack expressions use a multiplication sign; codes and prose remain unchanged. */
export function sampleQuantity(value) {
  return String(value ?? '').replace(/^(\s*\d+(?:[.,]\d+)?\s*)[xX](\s*\d+(?:[.,]\d+)?(?:\s*(?:g|gr|gram|kg|ml|l|pcs))?\s*)$/i,'$1×$2');
}

export function presentSampleQuantities(root) {
  const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode, parent = text.parentElement;
    if (!parent || parent.closest('script,style,textarea,option,[contenteditable], [data-isi-owned]')) continue;
    let value = text.data;
    if (/^\s*Sample QTY\s*x\s*QTY/i.test(value)) value = value.replace(/\bx\b/gi,'×');
    else if (/^\s*x\s*$/i.test(value) && parent.closest('#modalProduk,#modal-produk-masuk,[data-isi-sample-form]') && !parent.closest('button,a')) value = value.replace(/x/i,'×');
    else if (parent.closest('td,th,label,#modal-produk-masuk')) value = sampleQuantity(value);
    if (value !== text.data) text.data = value;
  }
}
