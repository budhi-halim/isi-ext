import { captureStatus, exportCapture, clearCapture, trackCaptureDownload, cleanDownloadedCaptures } from './debug-capture-store.js';

/** Keep diagnostic output behind the viewer's account unlock and release export URLs. */
export function createDebugCaptureUI({getAccount}) {
  const panel=document.querySelector('#debug-capture');
  const disclosure=panel.closest('details');
  const status=panel.querySelector('[data-debug-status]');
  const message=panel.querySelector('[data-debug-message]');
  const start=panel.querySelector('[data-debug-start]'),stop=panel.querySelector('[data-debug-stop]');
  const download=panel.querySelector('[data-debug-download]'),clearButton=panel.querySelector('[data-debug-clear]');
  let timer,generation=0,busy=false,objectUrl;
  const revoke=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;};
  function clear() {
    generation++;clearTimeout(timer);revoke();busy=false;
    for(const button of [start,stop,download,clearButton])button.disabled=true;
    status.textContent='Unlock this account’s saved copy to record diagnostics.';message.textContent='';
  }
  async function refresh() {
    clearTimeout(timer);
    const account=getAccount(),current=generation;
    if(!account)return clear();
    try {
      const value=await captureStatus(account);
      if(current!==generation || account!==getAccount())return;
      start.disabled=busy || !!value;stop.disabled=busy || !value?.active;
      download.disabled=busy || !value;clearButton.disabled=busy || !value || value.active;
      const text=value
        ? `${value.active?'Recording':'Stopped'} · ${value.count} events · ${(value.bytes/1048576).toFixed(1)} MB · ${value.failures} failure events · ${value.lastEvent || 'Waiting for activity'}${value.lastAt?` at ${new Date(value.lastAt).toLocaleTimeString()}`:''}${!value.active?` · ${value.reason || 'Time limit reached'}`:''}`
        : 'Ready. Start a capture, then use the online portal normally. Export after a failure or once several requests have completed.';
      if(status.textContent!==text)status.textContent=text;
    } catch {
      if(current===generation)status.textContent='Diagnostics could not be read. Unlock this account’s saved copy again.';
    }
    if(current===generation && disclosure.open)timer=setTimeout(refresh,2000);
  }
  async function act(action) {
    if(busy || !getAccount())return;
    busy=true;const account=getAccount(),current=generation;
    message.textContent='';clearTimeout(timer);
    for(const button of [start,stop,download,clearButton])button.disabled=true;
    try {await action(account,current);}
    catch(error){if(current===generation)message.textContent=error.message || 'The diagnostic operation could not finish.';}
    finally {if(current===generation){busy=false;timer=setTimeout(refresh,1500);}}
  }
  async function control(type,account) {
    const result=await chrome.runtime.sendMessage({type,account});
    if(!result?.ok)throw new Error(result?.error || 'The diagnostic recorder is unavailable.');
  }
  start.addEventListener('click',()=>act(async account=>{
    await control('debug-capture-start',account);
    message.textContent='Recording. One normal archive cycle has been requested; it still respects the shared queue.';
    chrome.runtime.sendMessage({type:'offline-check'}).catch(()=>{});
  }));
  stop.addEventListener('click',()=>act(async account=>{
    message.textContent='Finishing the current response before stopping…';
    await control('debug-capture-stop',account);message.textContent='Capture stopped. The diagnostic bundle is ready to download.';
  }));
  clearButton.addEventListener('click',()=>act(async account=>{await clearCapture(account);message.textContent='Diagnostic capture deleted. Your offline records are unchanged.';}));
  download.addEventListener('click',()=>act(async(account,current)=>{
    message.textContent='Finishing the current response and preparing the diagnostic file…';
    await control('debug-capture-stop',account);
    const bundle=await exportCapture(account);
    if(current!==generation || account!==getAccount())return;
    revoke();objectUrl=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));
    const downloadId = await chrome.downloads.download({url:objectUrl,
      filename:`islandsun-debug-${new Date(bundle.session.startedAt).toISOString().replaceAll(':','-')}.json`,saveAs:false});
    await trackCaptureDownload(account,bundle.session.id,downloadId);
    await cleanDownloadedCaptures();
    message.textContent='Diagnostic download started. The local capture is deleted after Chrome confirms completion. Attach the downloaded JSON file to the chat.';
  }));
  disclosure.addEventListener('toggle',()=>{if(disclosure.open)refresh();else clearTimeout(timer);});
  clear();
  return {clear,refresh};
}
