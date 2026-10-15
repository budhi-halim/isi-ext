(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  let port, retry, busy = false, interactionPort, interactionUntil = 0, interactionTimer, interactionRetry;
  const reads = new Map();
  const respond = (id,granted) => document.dispatchEvent(new CustomEvent('islandsun-table-read-response',{detail:{id,granted}}));
  function releaseRead(id,failed) {
    const current = reads.get(id);
    if (!current) return;
    reads.delete(id);
    try { current.postMessage({type:'finished',failed}); current.disconnect(); }
    catch { /* Worker shutdown already released this permit. */ }
  }
  document.addEventListener('islandsun-table-read-request',event => {
    const id = event.detail?.id;
    if (!Number.isSafeInteger(id) || reads.has(id)) return;
    if (reads.size >= 384) { respond(id,false); return; }
    try {
      const current = chrome.runtime.connect({name:'islandsun-table-read'});
      reads.set(id,current);
      current.onMessage.addListener(message => {
        if (message.granted) respond(id,true);
        else if (!message.yield) respond(id,false);
      });
      current.onDisconnect.addListener(() => {
        if (reads.get(id) !== current) return;
        reads.delete(id); respond(id,false);
      });
      current.postMessage({type:'read',kind:event.detail?.kind === 'sales-row-lookup' ? 'sales-row-lookup' : 'native-table'});
    } catch { releaseRead(id); respond(id,false); }
  });
  document.addEventListener('islandsun-table-read-finished',event => {
    const value = event.detail;
    if (!reads.has(value?.id)) return;
    releaseRead(value.id,typeof value.failed === 'boolean' ? value.failed : undefined);
    const status = Number(value.status) || 0;
    try {
      chrome.runtime.sendMessage({type:'connection-diagnostic',value:{kind:value.kind === 'sales-row-lookup' ? 'sales-row-lookup' : 'native-table',status,
        outcome:value.aborted ? 'cancelled' : value.failed ? status >= 400 ? 'http-error' : 'network-error' : 'complete',
        durationMs:Number.isFinite(value.started) ? Math.max(0,Date.now()-value.started) : 0}}).catch(() => {});
    } catch { /* Diagnostics cannot hold a completed table request. */ }
  });
  function release() { clearTimeout(retry); const previous = port; port = null; previous?.disconnect(); }
  function connect() {
    if (!busy || port) return;
    try {
      const current = chrome.runtime.connect({name:'islandsun-table-guard'});
      port = current;
      current.onDisconnect.addListener(() => {
        if (port !== current) return;
        port = null;
        if (busy) retry = setTimeout(connect,1000);
      });
    } catch { release(); }
  }
  function releaseInteraction() {
    clearTimeout(interactionTimer); clearTimeout(interactionRetry);
    const previous = interactionPort; interactionPort = null; previous?.disconnect();
  }
  function connectInteraction() {
    clearTimeout(interactionRetry);
    if (interactionUntil <= Date.now()) { releaseInteraction(); return; }
    try {
      if (!interactionPort) {
        const current = chrome.runtime.connect({name:'islandsun-interaction-guard'});
        interactionPort = current;
        current.onDisconnect.addListener(() => {
          if (interactionPort !== current) return;
          interactionPort = null;
          if (interactionUntil > Date.now()) interactionRetry = setTimeout(connectInteraction,1000);
        });
      }
      interactionPort.postMessage({until:interactionUntil});
      clearTimeout(interactionTimer);
      interactionTimer = setTimeout(releaseInteraction,interactionUntil-Date.now());
    } catch { releaseInteraction(); }
  }
  document.addEventListener('islandsun-table-activity',event => {
    busy = event.detail?.busy === true;
    if (busy) connect(); else release();
    interactionUntil = Math.min(Date.now() + 60000, Number(event.detail?.interactionUntil) || 0);
    connectInteraction();
  });
  window.addEventListener('pagehide',() => { busy = false; interactionUntil = 0; release(); releaseInteraction(); for (const id of reads.keys()) releaseRead(id); });
  window.addEventListener('pageshow',() => document.dispatchEvent(new Event('islandsun-table-activity-request')));
  document.dispatchEvent(new Event('islandsun-table-activity-request'));
})();
