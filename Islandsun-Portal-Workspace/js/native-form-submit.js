(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function (...args) {
    const tracked = document.documentElement.dataset.isiPortal === 'enabled'
      && this instanceof HTMLFormElement && this.closest('.content-wrapper');
    if (tracked && !this.dispatchEvent(new Event('islandsun-native-submit', {bubbles: true, cancelable: true}))) return;
    try { return Reflect.apply(submit, this, args); }
    catch (error) {
      if (tracked) this.dispatchEvent(new Event('islandsun-native-submit-failed', {bubbles: true}));
      throw error;
    }
  };
})();
