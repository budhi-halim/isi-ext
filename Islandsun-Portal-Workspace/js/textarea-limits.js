/** Expose native limits, with the portal's usual 255-character fallback. */
export function createTextareaLimits(root = document) {
  const controls = new Map(), events = new AbortController();
  let nextId = 0, resetFrame;
  function update(input) {
    const state = controls.get(input);
    if (!state) return;
    const count = input.value.length, limit = input.maxLength;
    state.counter.textContent = `${count}/${limit}`;
    state.counter.dataset.overLimit = String(count > limit);
    state.counter.hidden = input.disabled || input.readOnly;
    state.counter.setAttribute('aria-label',`${count} of ${limit} characters${count > limit ? '. Shorten this text before saving.' : ''}`);
  }
  function release(input, state) {
    state.counter.remove();
    const description = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== state.counter.id);
    if (description.length) input.setAttribute('aria-describedby',description.join(' '));
    else input.removeAttribute('aria-describedby');
    if (state.fallback && input.getAttribute('maxlength') === '255') {
      if (state.originalLimit === null) input.removeAttribute('maxlength');
      else input.setAttribute('maxlength',state.originalLimit);
    }
    controls.delete(input);
  }
  function enhance() {
    for (const [input,state] of controls) {
      if (!input.isConnected) release(input,state);
      else update(input);
    }
    for (const input of root.querySelectorAll('textarea:not([data-isi-owned]):not([readonly]):not([disabled])')) {
      if (input.closest('[data-isi-owned]')) continue;
      if (!controls.has(input)) {
        const fallback = input.maxLength < 0, originalLimit = input.getAttribute('maxlength');
        if (fallback) input.maxLength = 255;
        const counter = document.createElement('span');
        counter.className = 'isi-textarea-count'; counter.dataset.isiOwned = '';
        do { counter.id = `isi-textarea-count-${++nextId}`; } while (document.getElementById(counter.id));
        input.after(counter);
        input.setAttribute('aria-describedby',`${input.getAttribute('aria-describedby') || ''} ${counter.id}`.trim());
        controls.set(input,{counter,fallback,originalLimit});
      }
      update(input);
    }
  }
  for (const type of ['input','change','focusin']) root.addEventListener(type,event => update(event.target),{signal:events.signal});
  const observer = new MutationObserver(enhance);
  observer.observe(root.documentElement || root,{subtree:true,attributes:true,attributeFilter:['maxlength','disabled','readonly']});
  root.addEventListener('reset',() => {
    cancelAnimationFrame(resetFrame);
    resetFrame = requestAnimationFrame(() => { for (const input of controls.keys()) update(input); });
  },{signal:events.signal});
  return {enhance,destroy() { events.abort(); observer.disconnect(); cancelAnimationFrame(resetFrame); for (const [input,state] of controls) release(input,state); }};
}
