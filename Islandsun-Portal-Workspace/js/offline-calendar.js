import { businessDate } from './offline-config.js';

const DAY_MS = 86400000;
const isoDay = date => date.toISOString().slice(0,10);
export const AVAILABILITY_CATEGORIES = Object.freeze({blue:'Upcoming',red:'Overdue',green:'Handed over',blue_yellow:'ISR over 25 days',green_yellow:'Handover over 25 days'});

export function calendarMonth(value, now = new Date()) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') && Number(value.slice(0,4)) >= 1
    ? value : `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}

/** Six complete weeks include the neighboring dates shown by the native calendar. */
export function calendarDays(month) {
  const first = new Date(`${calendarMonth(month)}-01T00:00:00Z`);
  const start = first.getTime() - first.getUTCDay() * DAY_MS;
  return Array.from({length:42},(_,index) => isoDay(new Date(start + index * DAY_MS)));
}

export function shiftCalendarMonth(month, offset) {
  const first = new Date(`${calendarMonth(month)}-01T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth()+offset);
  return first.getUTCFullYear() < 1 || first.getUTCFullYear() > 9999 ? month : isoDay(first).slice(0,7);
}

/** Calendar placement uses ETA; archive eviction continues to use the request issue date. */
export function availabilityCalendarRows(rows, month) {
  const days = calendarDays(month), first = days[0], last = days.at(-1);
  return rows.filter(row => {
    const day = businessDate(row.fields.isrd_eta_2);
    return day && day >= first && day <= last;
  }).map(row => ({key:row.key,day:businessDate(row.fields.isrd_eta_2),number:row.fields.srs_no,
    product:row.fields.product_name,code:row.fields.product_code,source:row.fields.source_type,
    status:AVAILABILITY_CATEGORIES[row.fields.event_status] || row.fields.event_badge || '',
    category:Object.hasOwn(AVAILABILITY_CATEGORIES,row.fields.event_status) ? row.fields.event_status : 'unknown',
    tone:row.fields.jenis === 'serah_terima' ? 'handover' : 'internal'}))
    .sort((a,b) => a.day.localeCompare(b.day) || a.number.localeCompare(b.number) || a.key.localeCompare(b.key));
}
