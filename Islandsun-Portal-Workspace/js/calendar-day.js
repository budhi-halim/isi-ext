const DAY_MS = 86400000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Compare calendar dates without measuring elapsed hours or daylight-saving changes. */
export function calendarDay(value) {
  const text = String(value ?? '').trim();
  const named = /^(\d{1,2})-([a-z]{3})-(\d{4})$/i.exec(text);
  const iso = named ? `${named[3]}-${String(MONTHS.indexOf(named[2].toLowerCase()) + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}` : text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const stamp = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === iso ? stamp / DAY_MS : null;
}

export function localCalendarDate(now = Date.now()) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
