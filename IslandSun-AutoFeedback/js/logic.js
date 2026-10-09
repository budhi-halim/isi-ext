export const DEFAULT_SETTINGS = Object.freeze({ days: 180, komentar: 'Not ok', saran: 'Drop' });
export const ACTIVE_STATES = new Set(['starting', 'running', 'cancelling']);

export function validateSettings(input) {
  const days = Number(input?.days);
  if (input?.days === '' || !Number.isSafeInteger(days) || days < 1 || days > 36500) throw new Error('Enter a whole number of days between 1 and 36,500.');
  if (typeof input?.komentar !== 'string' || !input.komentar.trim()) throw new Error('Enter the default Komentar text.');
  if (typeof input?.saran !== 'string' || !input.saran.trim()) throw new Error('Enter the default Saran text.');
  return { days, komentar: input.komentar, saran: input.saran };
}

export function selectRequests(items, settings, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - settings.days);
  return items.filter(item => item && new Date(item.sr_date) <= cutoff &&
    typeof item.sr_statfeedback === 'string' && item.sr_statfeedback.toUpperCase() === 'BLANK' &&
    typeof item.sr_status === 'string' && Boolean(item.sr_status) && !item.sr_status.toUpperCase().includes('CANCEL'))
    .sort((first, second) => new Date(first.sr_date) - new Date(second.sr_date));
}

export function requestId(value) {
  const id = String(value ?? '');
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error('A sample request has an invalid identifier. No form was submitted for it.');
  return id;
}

export function isCompanyWorkspace(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'http://apps.islandsunindonesia.com:81' && parsed.pathname.startsWith('/islandsun/') && !/\/login(?:\/|$)/i.test(parsed.pathname);
  } catch { return false; }
}
