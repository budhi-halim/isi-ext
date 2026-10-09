/** Keep native table semantics and the record link while allowing clicks across the row. */
export function activateRecordRow(row, open) {
  row.dataset.recordRow = '';
  row.tabIndex = 0;
  row.addEventListener('click',event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || event.target.closest('a,button,input,select,textarea,summary')
      || String(window.getSelection()).trim()) return;
    open(row);
  });
  row.addEventListener('keydown',event => {
    if (event.target !== row || !['Enter',' '].includes(event.key) || event.repeat) return;
    event.preventDefault(); open(row);
  });
}
