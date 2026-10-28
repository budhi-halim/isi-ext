(() => {
  if (!['http://apps.islandsunindonesia.com:81', 'http://192.168.0.22:81'].includes(location.origin)) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const shouldSkip = () => reducedMotion.matches || document.documentElement.dataset.isiBoot === 'off';
  function observeTransition(transition) {
    // Resizing or skipping before capture legitimately rejects readiness.
    transition.ready.catch(() => {});
  }
  window.addEventListener('pageswap', event => {
    if (!event.viewTransition) return;
    observeTransition(event.viewTransition);
    if (shouldSkip()) event.viewTransition.skipTransition();
  });
  window.addEventListener('pagereveal', event => {
    const transition = event.viewTransition;
    if (!transition) return;
    observeTransition(transition);
    if (shouldSkip()) { transition.skipTransition(); return; }
    const root = document.documentElement;
    root.dataset.isiNavigation = 'retained';
    const release = () => { delete root.dataset.isiNavigation; };
    transition.finished.then(release, release);
  });
})();
