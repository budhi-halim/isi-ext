import { saveContract } from './save-contract.js';

/** Keep native Save and Cancel actions together without replacing their handlers. */
export function createRequestActions() {
  const groups = new Map();
  function restore(save) {
    const entry = groups.get(save);
    for (const [node, marker] of entry.originals) if (marker.isConnected) marker.replaceWith(node);
    entry.group.remove(); groups.delete(save);
  }
  return {
    enhance() {
      for (const save of groups.keys()) if (!save.isConnected) restore(save);
      for (const form of document.querySelectorAll('.content-wrapper form')) {
        if (!saveContract(form.action, location.href)) continue;
        const save = [...form.querySelectorAll('button,input[type="submit"]')].find(control =>
          !control.closest('.modal,dialog') && /^(save|simpan)(\s+update)?$/i.test((control.textContent || control.value).trim()));
        if (!save || groups.has(save)) continue;
        const original = save.parentElement.matches('.isi-save-input') ? save.parentElement : save;
        const cancel = [...original.parentElement.children].find(node => node !== original
          && node.matches('button,a,input') && /^(cancel|batal)$/i.test((node.textContent || node.value).trim()));
        const originals = [original, cancel].filter(Boolean).map(node => {
          const marker = document.createComment('native action'); node.before(marker); return [node, marker];
        });
        const group = document.createElement('div'); group.className = 'isi-save-actions'; original.before(group);
        group.append(...originals.map(([node]) => node)); groups.set(save, {group, originals});
      }
    },
    destroy() { for (const save of groups.keys()) restore(save); },
  };
}
