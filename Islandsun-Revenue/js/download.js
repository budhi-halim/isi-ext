/** Keep each object URL alive until Chrome has consumed its download. */
export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  if (!globalThis.chrome?.downloads?.download) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.split('/').at(-1);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      let id = null;
      const cleanup = () => { clearTimeout(timeout); chrome.downloads.onChanged.removeListener(changed); };
      const changed = delta => {
        if (delta.id !== id) return;
        if (delta.state?.current === 'complete') { cleanup(); resolve(); }
        if (delta.state?.current === 'interrupted') { cleanup(); reject(new Error('Download interrupted.')); }
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Download has not completed. Try saving it again.')); }, 120000);
      chrome.downloads.onChanged.addListener(changed);
      chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' }, downloadId => {
        if (chrome.runtime.lastError || downloadId === undefined) { cleanup(); reject(new Error('Download could not start.')); }
        else id = downloadId;
      });
    });
  } finally { URL.revokeObjectURL(url); }
}
