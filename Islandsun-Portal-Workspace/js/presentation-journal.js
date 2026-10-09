/** Record only synchronous extension edits; retain original nodes and their event handlers. */
export function createPresentationJournal() {
  const attributes = new Map(), texts = new Map();
  let children = [];
  const observer = new MutationObserver(() => {});
  function prune() {
    const owners = new Map();
    for (const mutation of children) for (const node of mutation.removedNodes) owners.set(node, mutation.target);
    function restorable(node) {
      const visited = new Set();
      while (node) {
        if (node.isConnected) return true;
        if (visited.has(node)) return false;
        visited.add(node);
        node = node.parentNode || owners.get(node);
      }
      return false;
    }
    // Retain originals detached by our own edits, but release rows replaced by the portal.
    children = children.filter(mutation => restorable(mutation.target));
    for (const node of attributes.keys()) if (!restorable(node)) attributes.delete(node);
    for (const node of texts.keys()) if (!restorable(node)) texts.delete(node);
  }
  function capture(change) {
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true, childList: true });
    try { return change(); }
    finally {
      const mutations = observer.takeRecords(); observer.disconnect();
      for (const mutation of mutations) {
        const target = mutation.target;
        if (mutation.type === 'attributes') {
          let values = attributes.get(target);
          if (!values) { values = new Map(); attributes.set(target, values); }
          const name = mutation.attributeName;
          const prior = values.get(name);
          values.set(name, { before: prior ? prior.before : mutation.oldValue, after: target.getAttribute(name) });
        } else if (mutation.type === 'characterData') {
          const prior = texts.get(target);
          texts.set(target, { before: prior ? prior.before : mutation.oldValue, after: target.data });
        } else children.push(mutation);
      }
      prune();
    }
  }
  function restore() {
    observer.disconnect();
    for (const mutation of children.reverse()) {
      if (!mutation.target.isConnected) continue;
      for (const node of mutation.addedNodes) if (node.parentNode === mutation.target) node.remove();
      const anchor = mutation.nextSibling?.parentNode === mutation.target ? mutation.nextSibling : null;
      for (const node of mutation.removedNodes) if (!node.isConnected) mutation.target.insertBefore(node, anchor);
    }
    for (const [node, values] of attributes) {
      if (!node.isConnected) continue;
      for (const [name, { before, after }] of values) {
        if (node.getAttribute(name) !== after && !name.startsWith('data-isi-')) continue;
        if (before === null) node.removeAttribute(name); else node.setAttribute(name, before);
      }
    }
    for (const [node, { before, after }] of texts) if (node.isConnected && node.data === after) node.data = before;
    attributes.clear(); texts.clear(); children.length = 0;
  }
  return { capture, restore };
}
