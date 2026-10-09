let account;
export function setOfflineAccount(value) { account = value; }

/** Reuse successful detail reads without an extra network request or page observer. */
export function rememberOfflineDetail(url, root, source) {
  if (!account || !source) return;
  try {
    const identity = root.querySelector('.user-menu a[href*="lockscreen?user="]');
    if (!identity || new URL(identity.getAttribute('href'),url).searchParams.get('user') !== account) return;
    chrome.runtime.sendMessage({type:'offline-observed-detail',account,url,...source}).catch(() => {});
  } catch { /* Archiving must not interrupt the original preview. */ }
}
