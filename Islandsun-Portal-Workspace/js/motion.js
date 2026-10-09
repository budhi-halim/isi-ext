const running = new Map();
const duration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;

/** Animate measured height so repeated toggles reverse from the current position. */
export function reveal(element, open, immediate = false) {
  const from = element.hidden ? 0 : element.getBoundingClientRect().height;
  const before = getComputedStyle(element);
  const paddingTop = element.hidden ? '0px' : before.paddingTop, paddingBottom = element.hidden ? '0px' : before.paddingBottom;
  running.get(element)?.cancel();
  element.hidden = false;
  element.inert = !open;
  const target = open ? element.getBoundingClientRect().height : 0;
  const natural = getComputedStyle(element);
  const animation = element.animate([{ height: `${from}px`, opacity: from ? 1 : 0, paddingTop, paddingBottom, overflow: 'hidden' }, { height: `${target}px`, opacity: open ? 1 : 0, paddingTop: open ? natural.paddingTop : '0px', paddingBottom: open ? natural.paddingBottom : '0px', overflow: 'hidden' }], { duration: immediate ? 0 : duration(), easing: 'ease-in-out' });
  running.set(element, animation);
  animation.onfinish = () => { if (running.get(element) !== animation) return; element.hidden = !open; running.delete(element); };
}

export function enterSurface(element) {
  running.get(element)?.cancel();
  const animation = element.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: duration(), easing: 'ease-out' });
  running.set(element, animation);
  animation.onfinish = () => running.delete(element);
}

export function exitSurface(element, done) {
  const current = getComputedStyle(element);
  const from = { opacity: current.opacity, transform: current.transform };
  running.get(element)?.cancel();
  const animation = element.animate([from, { opacity: 0, transform: 'translateY(-4px) scale(.98)' }], { duration: duration(), easing: 'ease-in', fill: 'forwards' });
  running.set(element, animation);
  animation.onfinish = () => { running.delete(element); done(); animation.cancel(); };
}

export function cancelMotion() { for (const animation of running.values()) animation.cancel(); running.clear(); }
