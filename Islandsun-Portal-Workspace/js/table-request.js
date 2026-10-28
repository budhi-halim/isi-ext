(() => {
  if (!['http://apps.islandsunindonesia.com:81', 'http://192.168.0.22:81'].includes(location.origin)) return;
  const prototype = XMLHttpRequest.prototype;
  const nativeOpen = prototype.open, nativeSend = prototype.send, nativeAbort = prototype.abort;
  const metadata = new WeakMap(), pending = new Map();
  let sequence = 0;
  const emit = (type, detail) => document.dispatchEvent(new CustomEvent(`islandsun-table-read-${type}`,{detail}));

  function tableRead(meta, body) {
    if (!meta?.async || !['GET','POST'].includes(meta.method) || meta.url.origin !== location.origin) return false;
    if (!meta.url.pathname.startsWith('/islandsun/')) return false;
    // DataTables' read-only protocol also uses POST. Never intercept arbitrary form writes.
    const values = meta.method === 'GET' ? meta.url.searchParams
      : typeof body === 'string' ? new URLSearchParams(body) : body instanceof URLSearchParams || body instanceof FormData ? body : null;
    return values && ['draw','start'].every(key => /^\d+$/.test(values.get(key) || ''))
      && /^(?:-1|\d+)$/.test(values.get('length') || '')
      && values.has('columns[0][data]') && values.has('search[value]');
  }
  function salesLookup(meta, body) {
    if (!meta?.async || meta.method !== 'POST' || meta.url.origin !== location.origin || typeof body !== 'string') return false;
    if (!/^\/islandsun\/Sales_order\/(?:getJmlSop|getSrsData|getTotalSop)\/?$/i.test(meta.url.pathname)) return false;
    const values = new URLSearchParams(body);
    return [...values.keys()].length === 1 && /^\d+$/.test(values.get('so_id') || '');
  }
  function finish(job, aborted = false) {
    if (!pending.delete(job.id)) return;
    clearTimeout(job.timer);
    job.xhr.removeEventListener('loadend',job.end);
    emit('finished',{id:job.id,kind:job.kind,status:job.xhr.status,aborted,started:job.started,
      failed:aborted ? undefined : !(job.xhr.status >= 200 && job.xhr.status < 300 || job.xhr.status === 304)});
  }
  function fail(job) {
    if (!pending.has(job.id)) return;
    nativeAbort.call(job.xhr);
    // An unsent native XHR emits no error; notify its existing transport callback.
    if (pending.has(job.id)) {
      job.xhr.dispatchEvent(new ProgressEvent('error'));
      job.xhr.dispatchEvent(new ProgressEvent('loadend'));
      finish(job);
    }
  }
  function send(job) {
    if (!pending.has(job.id) || job.sent) return;
    clearTimeout(job.timer); job.sent = true; job.started = Date.now();
    try { nativeSend.call(job.xhr,job.body); }
    catch { fail(job); }
  }
  prototype.open = function(method,url,async = true,...rest) {
    const prior = metadata.get(this)?.job;
    if (prior) finish(prior,true);
    const result = nativeOpen.call(this,method,url,async,...rest);
    metadata.set(this,{method:String(method).toUpperCase(),url:new URL(url,location.href),async:Boolean(async)});
    return result;
  };
  prototype.send = function(body) {
    const meta = metadata.get(this);
    if (this.readyState !== XMLHttpRequest.OPENED || meta?.job?.sent) return nativeSend.call(this,body);
    const table = tableRead(meta,body);
    if (document.documentElement?.dataset.isiPortal !== 'enabled' || !table && !salesLookup(meta,body)) return nativeSend.call(this,body);
    if (table) document.dispatchEvent(new Event('islandsun-table-transport-ready'));
    if (meta.job && pending.has(meta.job.id)) throw new DOMException('The request has already been sent.','InvalidStateError');
    const job = {id:++sequence,xhr:this,body,sent:false,kind:table ? 'native-table' : 'sales-row-lookup'};
    meta.job = job; pending.set(job.id,job);
    job.end = () => finish(job);
    this.addEventListener('loadend',job.end);
    job.timer = setTimeout(() => fail(job),table ? 60000 : 180000);
    emit('request',{id:job.id,kind:job.kind});
  };
  prototype.abort = function() {
    const job = metadata.get(this)?.job;
    if (job) finish(job,true);
    return nativeAbort.call(this);
  };
  document.addEventListener('islandsun-table-read-response',event => {
    const job = pending.get(event.detail?.id);
    if (!job) return;
    if (event.detail.granted) send(job); else fail(job);
  });
  function disabled() {
    if (document.documentElement?.dataset.isiPortal === 'enabled') return;
    for (const job of [...pending.values()]) {
      finish(job,true);
      if (!job.sent) nativeSend.call(job.xhr,job.body);
    }
  }
  const observe = () => new MutationObserver(disabled).observe(document.documentElement,{attributes:true,attributeFilter:['data-isi-portal']});
  if (document.documentElement) observe(); else document.addEventListener('DOMContentLoaded',observe,{once:true});
  window.addEventListener('pagehide',() => {
    for (const job of [...pending.values()]) { finish(job,true); nativeAbort.call(job.xhr); }
  });
})();
