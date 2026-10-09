export function previousYearDate(today = new Date()) {
  const year = today.getFullYear() - 1;
  const month = today.getMonth();
  const day = Math.min(today.getDate(), new Date(year, month + 1, 0).getDate());
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Let the server apply its own filter, including the initial table query and exports. */
export function applyDefaultFilterDate() {
  const from = document.querySelector('.content-wrapper form input#dari[name="dari"]');
  const form = from?.form;
  const current = new URL(location.href);
  if (!form || form.method.toLowerCase() !== 'get' || current.searchParams.has('dari')) return false;
  const action = new URL(form.action, location.href);
  const route = path => path.toLowerCase().replaceAll('_', '-').replace(/\/$/, '');
  if (action.origin !== current.origin || route(action.pathname) !== route(current.pathname)) return false;
  const today = new Date();
  if (from.value !== `${today.getFullYear()}-01-01`) return false;
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string' && !current.searchParams.has(key)) current.searchParams.set(key, value);
  }
  current.searchParams.set('dari', previousYearDate(today));
  location.replace(current.href);
  return true;
}
