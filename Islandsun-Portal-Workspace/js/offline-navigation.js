import { OFFLINE_SOURCES } from './offline-config.js';
import { icon } from './icons.js';
import { reveal } from './motion.js';

export const STOCK_CARD_KINDS = ['stock-products','stock-outstanding','stock-history','stock-adjustment'];
const GROUPS = [
  ['Sample Request','copy',[['sample','Sample requests']]],
  ['TIR','document',[['tir','List TIR']]],
  ['Stock Request','box',[['stock','Stock requests']]],
  ['Sales Order','document',[['sales','Sales orders']]],
  ['Logistic','list',[['availability','Product availability'],['stock-products','Stock views']]],
  ['Delivery Order','truck',[['delivery','List DO / View Schedule']]],
  ['Return & Replacement','box',[['returns','List Return & Replacement']]],
  ['Sudden Request','document',[['sudden','List Sudden Request']]],
];

function link(kind,label) {
  const item = document.createElement('a'); item.href = `?kind=${kind}`;
  item.textContent = label; item.dataset.kind = kind; return item;
}

/** Mirror the read-only destinations of the portal sidebar and Stock Card navigation. */
export function createOfflineNavigation(container,stockViews) {
  const groups = [];
  let initialized = false;
  for (const [index,[title,symbol,links]] of GROUPS.entries()) {
    const group = document.createElement('section'); group.className = 'offline-navigation-group';
    const button = document.createElement('button'); button.type = 'button';
    const label = document.createElement('span'); label.textContent = title;
    button.append(icon(symbol),label,icon('chevron'));
    const children = document.createElement('div'); children.id = `saved-navigation-${index}`; children.hidden = true;
    button.setAttribute('aria-expanded','false'); button.setAttribute('aria-controls',children.id);
    button.addEventListener('click',() => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded',String(open));
      reveal(children,open);
    });
    children.append(...links.map(([kind,text]) => link(kind,text)));
    group.append(button,children); container.append(group); groups.push({button,children,links});
  }
  const products = link('products','Product List'); products.prepend(icon('list')); container.append(products);
  stockViews.append(...STOCK_CARD_KINDS.map(kind => link(kind,OFFLINE_SOURCES[kind].title)));
  return {
    select(kind) {
      const stock = STOCK_CARD_KINDS.includes(kind);
      stockViews.hidden = !stock;
      for (const item of [...container.querySelectorAll('a'),...stockViews.querySelectorAll('a')]) {
        const selected = item.dataset.kind === kind || stock && item.closest('#sections') && item.dataset.kind === 'stock-products';
        if (selected) item.setAttribute('aria-current','page'); else item.removeAttribute('aria-current');
      }
      for (const group of groups) if (group.links.some(([key]) => key === kind || stock && key === 'stock-products')) {
        if (group.button.getAttribute('aria-expanded') !== 'true') reveal(group.children,true,!initialized);
        group.button.setAttribute('aria-expanded','true');
      }
      initialized = true;
    }
  };
}
