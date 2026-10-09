const paths = {
  list: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3',
  logout: 'M9 4H4v16h5M9 12h12m-4-4 4 4-4 4',
  refresh: 'M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
  sun: 'M12 3V1m0 22v-2M3 12H1m22 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  moon: 'M20.9 13.3A9 9 0 0 1 10.7 3.1 9 9 0 1 0 20.9 13.3Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6',
  mute: 'm3 3 18 18M6 8c0 7-3 7-3 9h13M9 3a6 6 0 0 1 9 5c0 2 0 3 1 5M9 21h6',
  copy: 'M16.5 8.25V6A2.25 2.25 0 0 0 14.25 3.75H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m8.25-8.25H18A2.25 2.25 0 0 1 20.25 10.5V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-7.5a2.25 2.25 0 0 1 2.25-2.25h6Z',
  close: 'm6 18 12-12M6 6l12 12',
  check: 'm4.5 12.75 6 6 9-13.5',
  arrow: 'M4.5 12h15m-6-6 6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  chevron: 'm9 5 7 7-7 7',
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  document: 'M14 3H6v18h12V7l-4-4Zm0 0v5h4M9 12h6M9 16h6',
  box: 'm3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10',
  chart: 'M4 3v18h17M8 17v-5m5 5V8m5 9V4',
  truck: 'M2 5h12v12H2V5Zm12 5h4l4 4v3h-8M7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm14 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  search: 'm21 21-5.2-5.2M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  clock: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.document); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path); return svg;
}
export function iconButton(name, label, callback) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'isi-portal-icon-button'; button.setAttribute('aria-label', label); button.append(icon(name)); button.addEventListener('click', callback); return button;
}

export function labelSaveAction(button, text) {
  const mark = icon('document');
  mark.dataset.isiSaveIcon = '';
  const label = document.createElement('span');
  label.textContent = text;
  button.replaceChildren(mark, label);
}
