(() => {
  if (globalThis.islandsunFeedbackInstalled) return;
  globalThis.islandsunFeedbackInstalled = true;
  import(chrome.runtime.getURL('js/content.js')).then(module => module.install()).catch(() => {
    globalThis.islandsunFeedbackInstalled = false;
  });
})();
