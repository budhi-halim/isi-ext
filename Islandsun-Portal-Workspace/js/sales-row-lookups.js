(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  const cache = new Map();
  let installed = false, generation = 0;
  // These three native column reads contain only an order ID, never a business mutation.
  function keyFor(options) {
    const url = new URL(options.url,location.href);
    if (url.origin !== location.origin || !/^\/islandsun\/Sales_order\/(?:getJmlSop|getSrsData|getTotalSop)\/?$/i.test(url.pathname)
      || options.type !== 'POST' || options.async === false || typeof options.data !== 'string') return null;
    const data = new URLSearchParams(options.data);
    if ([...data.keys()].length !== 1 || !/^\d+$/.test(data.get('so_id') || '')) return null;
    return `${generation}|${url.href}|${data.get('so_id')}`;
  }
  document.addEventListener('islandsun-table-transport-ready',() => {
    generation++;
    // Reuse responses only within the current draw, so refresh always sees server changes.
    for (const [key,entry] of cache) if (entry.result) cache.delete(key);
    const jquery = window.jQuery;
    if (installed || !jquery?.ajaxTransport) return;
    installed = true;
    jquery.ajaxTransport('+*',options => {
      if (document.documentElement.dataset.isiPortal !== 'enabled') return;
      const key = keyFor(options);
      if (!key) return;
      let entry, subscriber;
      return {
        send(headers,complete) {
          entry = cache.get(key);
          subscriber = (...result) => complete(...result);
          if (entry?.result) { queueMicrotask(() => subscriber?.(...entry.result)); return; }
          if (entry) { entry.subscribers.add(subscriber); return; }
          // Finished entries can be discarded; active entries retain their callbacks.
          for (const [savedKey,value] of cache) if (cache.size >= 300 && value.result) cache.delete(savedKey);
          if (cache.size >= 300) { queueMicrotask(() => subscriber?.(0,'error')); return; }
          const xhr = new XMLHttpRequest();
          entry = {xhr,generation,subscribers:new Set([subscriber])};
          cache.set(key,entry);
          const finish = (status,statusText,responses,responseHeaders) => {
            if (entry.done) return;
            entry.done = true;
            const result = [status,statusText,responses,responseHeaders];
            xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
            if (status >= 200 && status < 300 && entry.generation === generation) entry.result = result;
            else if (cache.get(key) === entry) cache.delete(key);
            const callbacks = [...entry.subscribers];
            entry.subscribers.clear();
            for (const callback of callbacks) {
              try { callback(...result); }
              catch (error) { setTimeout(() => { throw error; }); }
            }
          };
          xhr.open('POST',options.url,true);
          if (options.mimeType) xhr.overrideMimeType(options.mimeType);
          if (options.xhrFields?.withCredentials) xhr.withCredentials = true;
          for (const [name,value] of Object.entries(headers)) xhr.setRequestHeader(name,value);
          if (!Object.keys(headers).some(name => name.toLowerCase() === 'x-requested-with')) xhr.setRequestHeader('X-Requested-With','XMLHttpRequest');
          xhr.onload = () => finish(xhr.status,xhr.statusText,{text:xhr.responseText},xhr.getAllResponseHeaders());
          xhr.onerror = () => finish(xhr.status || 0,'error');
          xhr.onabort = () => finish(0,'abort');
          xhr.ontimeout = () => finish(0,'timeout');
          try { xhr.send(options.data); }
          catch { finish(0,'error'); }
        },
        abort() {
          entry?.subscribers.delete(subscriber);
          subscriber = null;
          if (entry && !entry.done && !entry.subscribers.size) entry.xhr.abort();
        },
      };
    });
  });
  window.addEventListener('pagehide',() => {
    for (const entry of cache.values()) if (!entry.done) entry.xhr.abort();
    cache.clear();
  });
})();
