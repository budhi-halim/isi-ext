/** Retain session transport counts and lifetimes, never cookie names or values. */
export function sessionTransport(headers, url, at) {
  const hostname = new URL(url).hostname.toLowerCase();
  let updates = 0, removals = 0, domainMismatches = 0, shortestLifetimeSeconds;
  for (const header of headers || []) {
    if (header.name?.toLowerCase() !== 'set-cookie' || typeof header.value !== 'string') continue;
    updates++;
    const attributes = new Map(header.value.split(';').slice(1).map(part => {
      const index = part.indexOf('=');
      return index < 0 ? [part.trim().toLowerCase(),''] : [part.slice(0,index).trim().toLowerCase(),part.slice(index+1).trim()];
    }));
    const domain = attributes.get('domain')?.toLowerCase().replace(/^\./,'');
    if (domain && hostname !== domain && !hostname.endsWith(`.${domain}`)) domainMismatches++;
    const maxAge = attributes.get('max-age');
    const lifetime = /^-?\d+$/.test(maxAge || '') ? Number(maxAge) : (Date.parse(attributes.get('expires')) - at) / 1000;
    if (!Number.isFinite(lifetime)) continue;
    if (lifetime <= 0) removals++;
    else shortestLifetimeSeconds = Math.min(shortestLifetimeSeconds ?? Infinity, Math.ceil(lifetime));
  }
  return updates ? {updates,removals,domainMismatches,...(shortestLifetimeSeconds === undefined ? {} : {shortestLifetimeSeconds})} : undefined;
}
