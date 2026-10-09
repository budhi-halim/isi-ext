(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  let last = 0;
  // The portal only watches window.onscroll; scrolling an inner table never reaches it.
  // Forward real input to its existing reset handler without changing the 30-minute timeout.
  function activity(event) {
    if (!event.isTrusted || document.documentElement.dataset.isiPortal !== 'enabled' || Date.now() - last < 1000) return;
    last = Date.now();
    if (typeof window.onmousemove === 'function') window.onmousemove.call(window, event);
  }
  for (const type of ['wheel','pointerdown','keydown','touchstart']) window.addEventListener(type, activity, { capture: true, passive: true });
  document.addEventListener('islandsun-session-pulse', () => {
    if (document.documentElement.dataset.isiPortal !== 'enabled') return;
    const reset = window.onmousemove;
    if (typeof reset === 'function' && reset.name === 'resetTimer') reset.call(window);
  });
})();
