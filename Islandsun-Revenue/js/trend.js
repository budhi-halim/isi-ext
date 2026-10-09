const DAY_MS = 86400000;
export const TREND_SETTINGS = Object.freeze({ bootstrap: 3, minimumJumpDays: 30, deltaMultiplier: 6, deltaWindow: 15, confirmation: 3 });
const median = values => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || /^(0000|1970)/.test(value)) return null;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) return null;
  return milliseconds / DAY_MS;
}

/** Isolate unusual dates from progress estimation without changing extraction decisions. */
export function createDateTrend() {
  let acceptedDay = null;
  const initial = [];
  const deltas = [];
  let pending = [];

  function observe(rawDate) {
    const day = parseDay(String(rawDate ?? '').trim());
    const thresholdDays = Math.max(TREND_SETTINGS.minimumJumpDays, TREND_SETTINGS.deltaMultiplier * (deltas.length ? median(deltas) : 0));
    let changed = false;
    if (day === null) {
      pending = [];
    } else if (acceptedDay === null) {
      initial.push(day);
      if (initial.length === TREND_SETTINGS.bootstrap) {
        acceptedDay = median(initial);
        changed = true;
      }
    } else if (Math.abs(day - acceptedDay) <= thresholdDays) {
      deltas.push(Math.abs(day - acceptedDay));
      if (deltas.length > TREND_SETTINGS.deltaWindow) deltas.shift();
      acceptedDay = day;
      pending = [];
      changed = true;
    } else {
      const candidate = pending.length ? median(pending) : null;
      const supportsCandidate = candidate !== null && Math.sign(day - acceptedDay) === Math.sign(candidate - acceptedDay) && Math.abs(day - candidate) <= thresholdDays;
      pending = supportsCandidate ? [...pending, day] : [day];
      if (pending.length === TREND_SETTINGS.confirmation) {
        const confirmedDay = median(pending);
        deltas.push(Math.abs(confirmedDay - acceptedDay));
        if (deltas.length > TREND_SETTINGS.deltaWindow) deltas.shift();
        acceptedDay = confirmedDay;
        pending = [];
        changed = true;
      }
    }
    return { changed, acceptedMs: acceptedDay === null ? null : acceptedDay * DAY_MS };
  }
  return { observe };
}
