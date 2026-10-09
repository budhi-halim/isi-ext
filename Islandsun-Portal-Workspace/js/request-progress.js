/** Provide an indeterminate, compositor-animated indicator without a JavaScript animation loop. */
export function createRequestProgress(label) {
  const progress = document.createElement('div');
  progress.className = 'isi-request-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', label);
  const bar = document.createElement('span');
  bar.setAttribute('aria-hidden', 'true');
  progress.append(bar);
  return progress;
}
