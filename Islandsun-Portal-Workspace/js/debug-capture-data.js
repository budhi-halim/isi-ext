// === Capture boundaries ===

export const CAPTURE_LIMITS = Object.freeze({responseBytes:8*1024*1024});
const SECRET = /password|passwd|pwd|token|secret|authorization|cookie|sessionid|phpsessid|csrf/i;
const PASSWORD_INPUT = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;

function attributeValue(tag, name) {
  const attribute = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(attribute);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

/** The signed-in shell includes an account-switch login form unrelated to record content. */
function omitAccountSwitchForm(value) {
  const classes = [...value.matchAll(/<(?:aside|div|section)\b[^>]*>/gi)]
    .flatMap(match => (attributeValue(match[0], 'class') || '').split(/\s+/));
  if (!classes.includes('main-sidebar') || !classes.includes('content-wrapper')) return value;
  return value.replace(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi, form => {
    const opening = form.match(/^<form\b[^>]*>/i)?.[0];
    if (attributeValue(opening || '', 'id') !== 'loginMultipleUser' || /<form\b/i.test(form.slice(opening.length))) return form;
    return '<!-- Account-switch authentication form omitted from diagnostic capture. -->';
  });
}

export function safeRequestUrl(value) {
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.hash = '';
    for (const name of [...url.searchParams.keys()]) if (SECRET.test(name)) url.searchParams.set(name,'[redacted]');
    return url.href;
  } catch { return '[invalid URL]'; }
}

export function safeRequestBody(value) {
  if (value == null) return null;
  if (typeof value !== 'string' && !(value instanceof URLSearchParams)) return '[body type omitted]';
  const parameters = new URLSearchParams(String(value));
  for (const name of [...parameters.keys()]) if (SECRET.test(name)) parameters.set(name,'[redacted]');
  return parameters.toString().slice(0,32768);
}

/** Keep source markup for parser replay while excluding authentication pages and known secrets. */
export function capturedText(value) {
  const source = PASSWORD_INPUT.test(value) ? omitAccountSwitchForm(value) : value;
  if (PASSWORD_INPUT.test(source)) return {omitted:'authentication-page'};
  let redactions = 0;
  const hide = () => { redactions++; return '[redacted]'; };
  const text = source
    .replace(/<input\b[^>]*>/gi, tag => {
      const secret = [attributeValue(tag, 'name'), attributeValue(tag, 'id')].some(name => name && SECRET.test(name));
      return secret ? tag.replace(/(\svalue\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (_, prefix) => `${prefix}"${hide()}"`) : tag;
    })
    .replace(/(["'](?:[^"']*(?:password|passwd|token|secret|authorization|cookie|PHPSESSID|csrf)[^"']*)["']\s*:\s*)(["'])(.*?)\2/gi,(_,prefix,quote) => `${prefix}${quote}${hide()}${quote}`)
    .replace(/\b(PHPSESSID|sessionid|access_token|csrf_token)=([^\s;"'<>]+)/gi,(_,name) => `${name}=${hide()}`);
  return {text,redactions,...(source !== value ? {omittedForms:['loginMultipleUser']} : {})};
}

export function responseHeaders(headers) {
  return Object.fromEntries(['content-type','content-length','content-encoding','cache-control','date','server','retry-after','server-timing'].flatMap(name => headers.has(name) ? [[name,headers.get(name)]] : []));
}

export function capturedError(error) {
  return {errorType:error.name,code:error.code,message:capturedText(String(error.message || '').slice(0,2000)).text || '[authentication message omitted]'};
}

export async function captureResponseBody(response) {
  if (!response.body) return {omitted:'no-readable-body'};
  const reader = response.clone().body.getReader(), chunks = [];
  let length = 0, truncated = false, errorType;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      const remaining = CAPTURE_LIMITS.responseBytes-length;
      chunks.push(value.slice(0,remaining)); length += Math.min(remaining,value.length);
      if (value.length > remaining || length === CAPTURE_LIMITS.responseBytes) { truncated = true; break; }
    }
  } catch (error) { errorType=error.name;truncated=true; }
  finally { if (truncated) reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  // The legacy HTTP portal's content context may not expose SubtleCrypto.
  const sha256 = crypto.subtle ? [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('') : undefined;
  const type = response.headers.get('content-type') || '';
  if (/text|json|xml|javascript/i.test(type) || /^[\s\r\n]*[<{[]/.test(new TextDecoder().decode(bytes.slice(0,80)))) {
    return {...capturedText(new TextDecoder().decode(bytes)),encoding:'utf-8',bytes:length,truncated,sha256,...(errorType?{errorType}:{})};
  }
  let binary = '';
  for (let index=0;index<bytes.length;index+=8192) binary += String.fromCharCode(...bytes.subarray(index,index+8192));
  return {base64:btoa(binary),encoding:'base64',bytes:length,truncated,sha256,...(errorType?{errorType}:{})};
}
