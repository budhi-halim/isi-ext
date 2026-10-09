/** Animate the visible slice without removing rows until the whole batch has left. */
export function createTrayClearMotion() {
  let active;
  function cancel() {
    if (!active) return;
    clearTimeout(active.timer);
    for (const timer of active.starts) clearTimeout(timer);
    for (const animation of active.animations) animation.cancel();
    for (const row of active.rows) {
      delete row.dataset.noticeQueued; delete row.dataset.noticeLeaving; delete row.dataset.noticeSkipped;
      row.inert = false;
    }
    delete active.list.dataset.noticeClearing;
    active = null;
  }
  return {
    cancel,
    remove(list, rows, done) {
      cancel();
      const batch = {list,rows,starts:[],animations:[]}; active = batch;
      const box = list.getBoundingClientRect(), dialog = list.closest('dialog').getBoundingClientRect();
      const top = Math.max(0,box.top,dialog.top), bottom = Math.min(innerHeight,box.bottom,dialog.bottom);
      const visible = rows.filter(row => { const rect = row.getBoundingClientRect(); return rect.bottom > top && rect.top < bottom; });
      const finish = () => {
        if (active !== batch) return;
        for (const row of rows) row.remove();
        cancel(); done();
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || !visible.length) { finish(); return; }
      list.dataset.noticeClearing = '';
      for (const row of rows) { row.inert = true; row.dataset.noticeQueued = 'true'; }
      for (const row of rows) if (!visible.includes(row)) row.dataset.noticeSkipped = '';
      visible.forEach((row,index) => {
        const start = () => {
          if (active !== batch) return;
          delete row.dataset.noticeQueued; row.dataset.noticeLeaving = 'true';
          if (row.animate) batch.animations.push(row.animate([
            {opacity:1,transform:'none'}, {opacity:0,transform:'translateX(-32px)'},
          ], {duration:180,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'}));
        };
        if (index) batch.starts.push(setTimeout(start,index*55)); else start();
      });
      batch.timer = setTimeout(finish,(visible.length-1)*55+190);
    },
  };
}
