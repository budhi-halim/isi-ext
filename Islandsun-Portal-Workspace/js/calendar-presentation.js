const FILTERS = {
  blue: ['Upcoming', 'Scheduled for today or later'],
  red: ['Overdue', 'Scheduled before today'],
  green: ['Handed over', 'Handover completed'],
  blue_yellow: ['ISR over 25 days', 'ISR is more than 25 days old'],
  green_yellow: ['Handover over 25 days', 'Handover is more than 25 days old'],
};
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function createCalendarPresentation() {
  const events = new AbortController();
  document.addEventListener('keydown', event => {
    const target = event.target.closest('[data-isi-calendar] .fc-event[role="button"]');
    if (target && ['Enter',' '].includes(event.key)) { event.preventDefault(); target.click(); }
  }, {signal:events.signal});
  function enhance() {
    const calendar = document.querySelector('#wrapper-calendar.fc');
    if (!calendar || !/\/daftar_kiriman_barang_sales\/?$/i.test(location.pathname)) return;
    calendar.dataset.isiCalendar = '';
    const filters = document.querySelector('#bulan')?.closest('.row');
    if (filters?.querySelector('#tahun')) filters.dataset.isiCalendarFilters = '';
    for (const option of document.querySelectorAll('#bulan option')) {
      const month = /^\d{1,2}$/.test(option.value) ? Number(option.value) : 0;
      if (month >= 1 && month <= 12 && option.textContent !== MONTHS[month - 1]) option.textContent = MONTHS[month - 1];
    }
    const selectedMonth = Number(document.querySelector('#bulan')?.value);
    const renderedMonth = document.querySelector('#select2-bulan-container');
    if (renderedMonth && selectedMonth >= 1 && selectedMonth <= 12 && renderedMonth.textContent !== MONTHS[selectedMonth - 1]) renderedMonth.textContent = MONTHS[selectedMonth - 1];
    for (const choice of document.querySelectorAll('#select2-bulan-results [role="treeitem"],#select2-bulan-results [role="option"]')) {
      const month = Number(choice.id.match(/-(\d{1,2})$/)?.[1]);
      if (month >= 1 && month <= 12 && choice.textContent !== MONTHS[month - 1]) choice.textContent = MONTHS[month - 1];
    }
    for (const row of document.querySelectorAll('.filter_color')) {
      const key = Object.keys(FILTERS).find(key => row.classList.contains(`f-${key}`));
      if (!key) continue;
      row.dataset.isiCalendarStatus = key;
      const button = row.querySelector('button');
      if (button) { button.textContent = FILTERS[key][0]; button.setAttribute('aria-label', `Filter: ${FILTERS[key][1]}`); }
      const description = row.cells[1];
      if (description) for (const node of description.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) node.textContent = `${FILTERS[key][1]} `;
    }
    const names = { prevYear:'Previous year',nextYear:'Next year',prev:'Previous month',next:'Next month' };
    for (const [key, name] of Object.entries(names)) calendar.querySelector(`.fc-${key}-button`)?.setAttribute('aria-label',name);
    for (const event of calendar.querySelectorAll('.fc-event')) {
      const foreground = event.style.color.toLowerCase().replaceAll(' ','');
      const background = event.style.backgroundColor.toLowerCase().replaceAll(' ','');
      const green = ['rgb(39,174,96)','rgb(32,151,82)','#27ae60','#209752','green'].includes(background);
      const red = ['rgb(192,57,43)','#c0392b','red'].includes(background);
      const yellow = ['rgb(245,203,42)','#f5cb2a','yellow'].includes(foreground);
      event.dataset.isiCalendarStatus = red ? 'red' : green ? (yellow ? 'green_yellow' : 'green') : (yellow ? 'blue_yellow' : 'blue');
      if (!event.hasAttribute('href')) { event.tabIndex = 0; event.setAttribute('role','button'); }
    }
  }
  return {enhance,destroy(){events.abort();}};
}
