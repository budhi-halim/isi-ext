(() => {
  const DAY = 86400000;

  // Classic MAIN-world content scripts share this helper without executable DOM injection.
  function earliestDate({ start, end = Infinity, after = -Infinity, allowed }) {
    if (!Number.isFinite(start) || Number.isNaN(end)) return null;
    const first = Math.max(Math.ceil(start / DAY), Math.floor(after / DAY) + 1);
    const last = Math.min(Math.floor(end / DAY), first + 3660);
    for (let day = first; day <= last; day += 1) {
      const date = new Date(day * DAY);
      if (allowed(date)) return date;
    }
    return null;
  }

  Object.defineProperty(window, Symbol.for('islandsun.date-selection'), {
    value: Object.freeze({ earliestDate }), configurable: true,
  });
})();
