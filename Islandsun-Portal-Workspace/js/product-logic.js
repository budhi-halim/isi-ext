const identity = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Non-General issued samples append their product code as the final space-delimited word. */
export function splitIssuedProduct(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  const boundary = text.lastIndexOf(' ');
  return boundary > 0 ? {name: text.slice(0, boundary), code: text.slice(boundary + 1)} : {name: text, code: null};
}

/** Original requests may be free text; only a full eight-digit product code is inferred. */
export function splitRequestedProduct(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  const match = text.match(/^(.+) (\d{8})$/);
  return match ? {name:match[1],code:match[2]} : {name:text,code:null};
}

/** Issued entries win exact name/code matches; unmatched requests remain visibly provisional. */
export function mergeProducts(requested, issued, { includeRequested = true } = {}) {
  const provided = issued.map(item => ({ ...item, requested: false }));
  if (!includeRequested) return provided;
  const remaining = requested.filter(item => !issued.some(actual =>
    (item.code && actual.code && identity(item.code) === identity(actual.code)) ||
    ((!item.code || !actual.code) && identity(item.name) && identity(item.name) === identity(actual.name)) ||
    (item.code && identity(`${item.name} ${item.code}`) === identity(actual.name)) ||
    (actual.code && identity(item.name) === identity(`${actual.name} ${actual.code}`))));
  return [...provided, ...remaining.map(item => ({ ...item, requested: true }))];
}

/** Only General requests identify existing products still owed to the customer. */
export function hasRequestedProducts(type) {
  return Number(type) === 1;
}
