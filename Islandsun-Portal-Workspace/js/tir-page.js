/** Identify returned TIR screens by their native controls, including POST response URLs. */
export function isTirForm(root = document, pathname = location.pathname) {
  return /^\/islandsun\/(?:index\.php\/)?master\/tir(?:\/|$)/i.test(pathname)
    && Boolean(root.querySelector('#tir_jenis'));
}

export function isTirList(root = document, pathname = location.pathname) {
  if (!/^\/islandsun\/(?:index\.php\/)?master\/tir(?:\/|$)/i.test(pathname) || isTirForm(root, pathname)) return false;
  return [...root.querySelectorAll('#mytable thead th')].some(cell => /^no\.?\s*tir$/i.test(cell.textContent.trim()));
}
