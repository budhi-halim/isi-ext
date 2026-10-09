(() => {
  function pageSize(availableHeight, rowHeight) {
    if (!Number.isFinite(availableHeight) || !Number.isFinite(rowHeight) || rowHeight <= 0) return 10;
    return Math.max(10, Math.min(100, Math.floor(availableHeight / rowHeight / 5) * 5));
  }
  Object.defineProperty(window, Symbol.for('islandsun.table-density'), {
    value: Object.freeze({ pageSize }), configurable: true,
  });
})();
