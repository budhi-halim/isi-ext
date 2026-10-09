import { calendarDays, calendarMonth, shiftCalendarMonth } from './offline-calendar.js';

const create = (tag,text,className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};

export function createOfflineCalendar(root,{onChange,onOpen}) {
  const monthInput = root.querySelector('[data-calendar-month]');
  const grid = root.querySelector('[data-calendar-grid]');
  const heading = root.querySelector('[data-calendar-heading]');
  const count = root.querySelector('[data-calendar-count]');
  let month = calendarMonth('');
  function change(value) {
    month = calendarMonth(value); monthInput.value = month; onChange(month);
  }
  monthInput.addEventListener('change',() => change(monthInput.value));
  for (const button of root.querySelectorAll('[data-calendar-offset]')) {
    button.addEventListener('click',() => change(shiftCalendarMonth(month,Number(button.dataset.calendarOffset))));
  }
  root.querySelector('[data-calendar-today]').addEventListener('click',() => change(calendarMonth('')));
  return {
    clear() { grid.replaceChildren(); count.textContent = ''; },
    render(value,rows) {
      month = calendarMonth(value); monthInput.value = month;
      heading.textContent = new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined,{month:'long',year:'numeric'});
      const byDay = new Map();
      for (const row of rows) {
        if (!byDay.has(row.day)) byDay.set(row.day,[]);
        byDay.get(row.day).push(row);
      }
      const today = new Date(), todayString = `${calendarMonth('',today)}-${String(today.getDate()).padStart(2,'0')}`;
      const fragment = document.createDocumentFragment();
      for (const day of calendarDays(month)) {
        const cell = create('section',null,'offline-calendar-day');
        const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
        cell.setAttribute('aria-label',label);
        cell.dataset.outside = String(!day.startsWith(month));
        const time = create('time',String(Number(day.slice(-2)))); time.dateTime = day;
        if (day === todayString) time.setAttribute('aria-current','date');
        cell.append(time);
        const entries = byDay.get(day) || [];
        const makeButton = row => {
          const button = create('button',null,'offline-calendar-event'); button.type = 'button'; button.dataset.source = row.tone;
          button.dataset.category = row.category;
          button.setAttribute('aria-label',[row.number,row.code,row.product,row.source,row.status].filter(Boolean).join(' · '));
          button.append(create('strong',row.number),create('small',row.status || row.source));
          button.addEventListener('click',() => onOpen(row.key,button));
          return button;
        };
        entries.slice(0,3).forEach(row => cell.append(makeButton(row)));
        if (entries.length > 3) {
          const details = create('details',null,'offline-calendar-more');
          details.append(create('summary',`${entries.length-3} more`));
          const extra = create('div'); details.append(extra);
          details.addEventListener('toggle',() => {
            if (details.open && !extra.childElementCount) extra.replaceChildren(...entries.slice(3).map(makeButton));
          });
          cell.append(details);
        }
        fragment.append(cell);
      }
      grid.replaceChildren(fragment);
      count.textContent = `${rows.length.toLocaleString()} saved entries in these six weeks. Calendar dates are ETAs; the saved request date is retained separately.`;
    }
  };
}
