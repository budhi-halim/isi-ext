export function portalPath(value) {
  return value.replace(/^\/islandsun\/index\.php\//i, '/islandsun/').replace(/\/$/, '').toLowerCase();
}

export function saveContract(action, current) {
  const page = new URL(current), target = new URL(action, page);
  if (target.origin !== page.origin || target.search || target.hash) return null;
  const path = portalPath(target.pathname), route = portalPath(page.pathname);
  if (path === '/islandsun/master/tir/store' && route === '/islandsun/master/tir/create') return {kind:'tir', id:null};
  if (path === '/islandsun/master/tir/update') {
    const match = /^\/islandsun\/master\/tir\/edit\/([1-9]\d*)$/.exec(route);
    return match ? {kind:'tir', id:match[1]} : null;
  }
  const sampleCreate = route === '/islandsun/samplerequest/add'
    || route === '/islandsun/samplerequest/getimprovement' && /^[1-9]\d*$/.test(page.searchParams.get('sr_id'));
  if (path === '/islandsun/samplerequest/processaddsamplerequestnew' && sampleCreate) return {kind:'sample', id:null};
  if (path === '/islandsun/samplerequest/processupdatesamplerequestnew' && route === '/islandsun/samplerequest/edit' && /^[1-9]\d*$/.test(page.searchParams.get('id'))) return {kind:'sample', id:page.searchParams.get('id')};
  return null;
}

/** Require every submitted non-hidden field to be present with the same returned value. */
export function sameSavedFields(expected, actual) {
  return Object.keys(expected).length > 0 && Object.entries(expected).every(([name,value]) =>
    Object.hasOwn(actual, name) && JSON.stringify(value) === JSON.stringify(actual[name]));
}

export function sameSavedRecord(pending, record) {
  return Boolean(record && pending.kind === record.kind && (pending.id ? pending.id === record.id : pending.kind === 'sample' && pending.number === record.number)
    && (!pending.number || pending.number === record.number));
}
