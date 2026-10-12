export const DEFAULT_FILTER_START = '2019-01-01';

const DATE_FILTER_ROUTES = new Set([
  '/islandsun/samplerequest', '/islandsun/master/tir', '/islandsun/stock-request/list-srs',
  '/islandsun/sales-order', '/islandsun/newdo', '/islandsun/stock-request/listcomplain',
  '/islandsun/suddenrequest/list-sudden',
]);
const route = path => path.toLowerCase().replace('/index.php/', '/').replaceAll('_', '-').replace(/\/$/, '');

/** Set defaults before the portal redirects bare list links to its current-year filter. */
export function defaultFilterLink(href, base, today = new Date()) {
  const url = new URL(href, base);
  if (url.origin !== new URL(base).origin || !DATE_FILTER_ROUTES.has(route(url.pathname))
    || url.searchParams.has('dari') || url.searchParams.has('sampai')) return null;
  url.searchParams.set('dari', DEFAULT_FILTER_START);
  url.searchParams.set('sampai', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
  return url.href;
}

export function applyDefaultFilterLinks() {
  for (const link of document.querySelectorAll('.sidebar-menu a[href]')) {
    if (link.getAttribute('href').startsWith('#')) continue;
    const href = defaultFilterLink(link.href, location.href);
    if (href) link.href = href;
  }
}

/** Let the server apply its own filter, including the initial table query and exports. */
export function applyDefaultFilterDate() {
  const from = document.querySelector('.content-wrapper form input#dari[name="dari"]');
  const form = from?.form;
  const current = new URL(location.href);
  if (!form || form.method.toLowerCase() !== 'get' || current.searchParams.has('dari')) return false;
  const action = new URL(form.action, location.href);
  if (action.origin !== current.origin || route(action.pathname) !== route(current.pathname)) return false;
  const today = new Date();
  if (from.value !== `${today.getFullYear()}-01-01`) return false;
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string' && !current.searchParams.has(key)) current.searchParams.set(key, value);
  }
  current.searchParams.set('dari', DEFAULT_FILTER_START);
  location.replace(current.href);
  return true;
}
