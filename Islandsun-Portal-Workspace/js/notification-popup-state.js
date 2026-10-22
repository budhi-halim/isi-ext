/** Skip popup delivery without acknowledging, deleting or silencing the tray notice. */
export function bypassPopupNotices(state, ids = Object.keys(state.notices)) {
  const notices = {...state.notices};
  let changed = false;
  for (const id of ids) {
    const item = notices[id];
    if (!item || item.delivered && !item.claim) continue;
    notices[id] = {...item, delivered:true};
    delete notices[id].claim;
    changed = true;
  }
  return changed ? {...state, notices} : state;
}

/** Keep suppressed transient feedback accessible in the tray, with repeated messages merged. */
export function retainPopupNotice(state, request, now = Date.now()) {
  const message = String(request.message || '').trim().slice(0,4000);
  if (!message) return state;
  const id = `popup:${String(request.key || message).slice(0,240)}`;
  const tone = ['success','warning','error'].includes(request.tone) ? request.tone : 'success';
  const customer = String(request.customer || '').slice(0,300);
  const url = String(request.href || '').slice(0,2000);
  const previous = state.notices[id];
  if (previous?.message === message && previous.tone === tone && previous.customer === customer && previous.url === url) return state;
  return {...state, notices:{...state.notices, [id]:{id, type:'system', message, tone, customer, url, created:now, delivered:true}}};
}
