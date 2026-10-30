import { portalUrl } from './shared/portal-address.js';

/** Background reads reuse the session without entering the portal's navigation/ID-rotation path. */
export function portalReadOptions(url, options = {}) {
  const headers = new Headers(options.headers);
  if (portalUrl(String(url))) headers.set('X-Requested-With', 'XMLHttpRequest');
  return {...options, headers, credentials:'include', redirect:'manual'};
}
