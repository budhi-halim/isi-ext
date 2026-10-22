const EXIT_DURATION = 220;
const MOVE_DURATION = 240;
const EASING = 'cubic-bezier(.2,.8,.2,1)';

/** Sweep the visible departing cards, then close gaps without exposing offscreen departures. */
export function createTrayClearMotion() {
  let active;

  function cancel() {
    if (!active) return;
    const batch = active;
    active = null;
    for (const animation of batch.animations) animation.cancel();
    for (const row of batch.rows) {
      delete row.dataset.noticeLeaving;
      delete row.dataset.noticeSkipped;
      row.inert = false;
    }
    delete batch.list.dataset.noticeClearing;
    delete batch.dialog.dataset.noticeMoving;
  }

  function animate(batch, node, frames, duration, delay = 0) {
    if (!node.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
    const animation = node.animate(frames, {duration, delay, easing:EASING, fill:'both'});
    batch.animations.add(animation);
    return animation.finished.catch(() => {});
  }

  async function remove(list, rows, done, afterRemoval = () => {}) {
    cancel();
    const dialog = list.closest('dialog');
    const batch = {list, dialog, rows, animations:new Set()};
    active = batch;
    list.dataset.noticeClearing = '';
    dialog.dataset.noticeMoving = '';
    const box = dialog.getBoundingClientRect();
    const header = dialog.querySelector('.isi-notification-header')?.getBoundingClientRect();
    const top = Math.max(0, box.top, header?.bottom || 0), bottom = Math.min(innerHeight, box.bottom);
    const visible = node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > top && rect.top < bottom;
    };
    const visibleRows = rows.filter(visible);
    const step = Math.min(65, 420 / Math.max(1, visibleRows.length - 1));
    await Promise.all(rows.map(row => {
      row.inert = true;
      row.dataset.noticeLeaving = 'true';
      const index = visibleRows.indexOf(row);
      if (index < 0) { row.dataset.noticeSkipped = ''; return undefined; }
      const style = getComputedStyle(row);
      return animate(batch, row, [
        {opacity:style.opacity, transform:style.transform},
        {opacity:0, transform:'translateX(-48px)'},
      ], EXIT_DURATION, index * step);
    }));
    if (active !== batch) return;

    const before = new Map([...list.children].map(node => [node, node.getBoundingClientRect().top]));
    const height = getComputedStyle(list).height;
    for (const row of rows) row.remove();
    afterRemoval();
    const targetHeight = getComputedStyle(list).height;
    // Measure the final scroll position before fixing the list's starting height.
    const offsets = [...list.children].map(node => ({node, offset:before.get(node) - node.getBoundingClientRect().top}));
    const movement = offsets.filter(({node, offset}) => Math.abs(offset) > .5 && visible(node)).map(({node, offset}) =>
      animate(batch, node, [{transform:`translateY(${offset}px)`}, {transform:'none'}], MOVE_DURATION));
    if (height !== targetHeight) movement.push(animate(batch, list, [{height}, {height:targetHeight}], MOVE_DURATION));
    await Promise.all(movement);
    if (active !== batch) return;
    cancel();
    done();
  }

  return {get busy() { return Boolean(active); }, cancel, remove};
}
