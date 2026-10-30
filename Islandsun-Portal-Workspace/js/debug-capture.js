import { portalUrl } from './shared/portal-address.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { safeRequestUrl, safeRequestBody, captureResponseBody, responseHeaders, capturedText, CAPTURE_LIMITS } from './debug-capture-data.js';
import { appendJournal, diagnosticFields } from './diagnostic-journal-store.js';


/** Passive instrumentation: capture only requests the application already decided to make. */
export function startDebugCapture() {
  const clientRequests = new Map();
  let journalFailure = false;
  function track(operation) {
    void operation.catch(() => {});
    return operation;
  }
  async function captureContext() {
    const scope = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
    return {id:`automatic:${scope?.account || ''}`,account:scope?.account || '',expiresAt:Date.now()+86400000};
  }
  async function note(event,fields={},session=null) {
    const scope = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
    const {body,...metadata} = fields;
    if (session?.account && session.account !== scope?.account) return;
    try {
      await appendJournal(session?.account || scope?.account || '', event, {...diagnosticFields(metadata),...(body ? {body} : {})});
      if (journalFailure) { journalFailure = false; await chrome.storage.local.remove('islandsun.journal-error'); }
    } catch (error) {
      journalFailure = true;
      await chrome.storage.local.set({'islandsun.journal-error':{at:Date.now(),name:error.name,message:'Diagnostic history could not be saved.'}}).catch(()=>{});
    }
  }
  async function read(url,options,context={}) {
    let session;
    try { session=await captureContext(); } catch { session=null; }
    if(!session)return fetch(url,options);
    const attemptId=crypto.randomUUID(),startedAt=Date.now();
    const request={url:safeRequestUrl(String(url)),method:options.method || 'GET',body:safeRequestBody(options.body),credentials:options.credentials || 'same-origin',redirect:options.redirect || 'follow',cache:options.cache || 'default',timeoutMs:context.timeoutMs,initiator:'extension-service-worker',referrerPolicy:options.referrerPolicy || 'browser-default'};
    const headers=new Headers(options.headers);
    request.headers=Object.fromEntries(['accept','content-type','x-requested-with'].flatMap(name=>headers.has(name)?[[name,headers.get(name)]]:[]));
    const startedLog = track(note('request-start',{...context,attemptId,request},session));
    const networkStartedAt=Date.now();
    let response;
    try { response=await fetch(url,options); }
    catch(error){track(startedLog.then(() => note('request-failed',{...context,attemptId,durationMs:Date.now()-startedAt,fetchMs:Date.now()-networkStartedAt,diagnosticStartMs:networkStartedAt-startedAt,errorType:error.name,failure:true},session)));throw error;}
    const headersAt=Date.now();
    const headersLog = track(startedLog.then(() => note('response-headers',{...context,attemptId,status:response.status,type:response.type,url:safeRequestUrl(response.url || url),headers:responseHeaders(response.headers),headersMs:headersAt-networkStartedAt,diagnosticStartMs:networkStartedAt-startedAt,failure:response.status>=400},session)));
    const bodyStartedAt=Date.now();
    track(captureResponseBody(response).then(async body => {
      const timings = {bodyMs:Date.now()-bodyStartedAt,diagnosticHeadersMs:bodyStartedAt-headersAt,durationMs:Date.now()-startedAt};
      await headersLog;
      await note('response-body',{...context,attemptId,body,...timings},session);
    }, async error => {
      await headersLog;
      await note('capture-body-failed',{...context,attemptId,errorType:error.name,failure:true},session);
    }));
    return response;
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if (message?.type === 'diagnostic-event') {
      const ownPage = sender.id === chrome.runtime.id && (sender.url?.startsWith(chrome.runtime.getURL('')) || portalUrl(sender.url));
      if (!ownPage || typeof message.event !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(message.event)) return;
      note(message.event,{...diagnosticFields(message.fields || {}),tabId:sender.tab?.id}).then(()=>respond({ok:true}),()=>respond({ok:false}));
      return true;
    }
    if (['debug-portal-start','debug-portal-event','debug-portal-processing'].includes(message?.type)) {
      if (sender.id!==chrome.runtime.id || !sender.tab || !portalUrl(sender.url)) return;
      (async()=>{
        const session=await captureContext();
        if (!session) return {};
        const context={initiator:'extension-content-script',tabId:sender.tab.id};
        const validUrl=value=>{
          try {const url=new URL(value);return portalUrl(url.href);}
          catch {return false;}
        };
        if (message.type==='debug-portal-start') {
          for (const [id,value] of clientRequests) if (value.expiresAt<Date.now() || value.sessionId!==session.id) clientRequests.delete(id);
          if (clientRequests.size>=64 || !validUrl(message.request?.url) || !/^(?:sample|tir|portal)-(?:index|detail|products|source|read)$/.test(message.kind)) return {};
          const attemptId=crypto.randomUUID();
          clientRequests.set(attemptId,{...context,documentId:sender.documentId,sessionId:session.id,kind:message.kind,expiresAt:Date.now()+120000});
          const request={url:safeRequestUrl(message.request.url),method:message.request.method==='POST'?'POST':'GET',body:safeRequestBody(message.request.body),credentials:'include',redirect:'manual',ajax:message.request.ajax === true,timeoutMs:[25000,60000,120000].includes(message.request.timeoutMs) ? message.request.timeoutMs : 25000};
          await note('request-start',{...context,attemptId,kind:message.kind,request},session);
          return {attemptId,expiresAt:session.expiresAt};
        }
        if (message.type==='debug-portal-processing') {
          if (!validUrl(message.url) || !['preview-dom-parse','observed-detail-parse'].includes(message.operation)) return {};
          if (!Number.isFinite(message.durationMs) || !Number.isInteger(message.nodes)) return {};
          await note('processing-complete',{...context,url:safeRequestUrl(message.url),operation:message.operation,durationMs:message.durationMs,nodes:message.nodes},session);
          return {};
        }
        const entry=clientRequests.get(message.attemptId);
        if (!entry || entry.sessionId!==session.id || entry.tabId!==sender.tab.id || entry.documentId!==sender.documentId) return {};
        if (!['response-headers','response-body','capture-body-failed','request-failed'].includes(message.event)) return {};
        const input=message.fields || {},fields={...context,attemptId:message.attemptId,kind:entry.kind};
        for (const key of ['durationMs','headersMs','bodyMs']) if (Number.isFinite(input[key])) fields[key]=Math.max(0,input[key]);
        if (message.event==='response-headers') {
          fields.status=Number.isInteger(input.status)?input.status:0;
          fields.url=validUrl(input.url)?safeRequestUrl(input.url):'[unavailable]';
          fields.type=String(input.type || '').slice(0,40);
          fields.headers=responseHeaders(new Headers(input.headers || {}));
          fields.failure=fields.status>=400;
        } else {
          clientRequests.delete(message.attemptId);
          if (message.event==='response-body') {
            const body=input.body || {};
            if (typeof body.text==='string' && body.text.length<=CAPTURE_LIMITS.responseBytes) fields.body=capturedText(body.text);
            else if (typeof body.base64==='string' && body.base64.length<=Math.ceil(CAPTURE_LIMITS.responseBytes/3)*4) fields.body={base64:body.base64};
            else fields.body={omitted:String(body.omitted || 'body-limit').slice(0,80)};
            Object.assign(fields.body,{encoding:body.encoding==='base64'?'base64':'utf-8',bytes:Number(body.bytes)||0,truncated:!!body.truncated,sha256:/^[a-f0-9]{64}$/.test(body.sha256)?body.sha256:undefined});
            if (!fields.body.sha256 && !fields.body.omitted) {
              const bytes=fields.body.base64 ? Uint8Array.from(atob(fields.body.base64),character=>character.charCodeAt(0)) : new TextEncoder().encode(fields.body.text || '');
              fields.body.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
              fields.body.hashSource='stored-capture';
            }
            if (body.errorType) fields.body.errorType=String(body.errorType).slice(0,80);
          } else {fields.errorType=String(input.errorType || 'Error').slice(0,80);fields.failure=true;}
        }
        await note(message.event,fields,session);
        return {};
      })().then(respond,()=>respond({}));
      return true;
    }
  });
  note('worker-start',{version:chrome.runtime.getManifest().version}).catch(()=>{});
  return {note,recording:()=>true,fetch(url,options,context){
    return track(read(url,options,context));
  }};
}
