/** Identify the portal's returned account without relying on editable form fields. */
export function savedPageAccount(doc) {
  const link = doc.querySelector('.user-menu a[href*="lockscreen?user="]');
  try { return link && new URL(link.href).searchParams.get('user'); } catch { return null; }
}

/** The portal also returns a bare session-expired message at an ordinary action URL. */
export function saveNeedsSignIn(doc, href) {
  if (/\/login(?:\/|$)/i.test(new URL(href).pathname)
    || doc.querySelector('.lockscreen-credentials,input[type="password"]:not(#loginMultipleUser input)')) return true;
  if (savedPageAccount(doc)) return false;
  return /sesi\s+anda\s+habis|session\s+(?:has\s+)?expired|silahkan\s+login\s+kembali/i.test(doc.body?.textContent || '');
}
