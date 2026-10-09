import {createRequestProgress} from './request-progress.js';

/** Present native Get Data progress without issuing or retrying portal requests. */
export function createImprovementLoading({notify = () => {}, onLoaded = () => {}} = {}) {
  const events = new AbortController();
  let surface, current = 0;
  function remove() {
    if (!surface) return;
    const {dialog, focus} = surface;
    dialog.close(); dialog.remove(); surface = null;
    if (focus?.isConnected) focus.focus({preventScroll: true});
  }
  function show() {
    if (surface) return surface;
    const dialog = document.createElement('dialog');
    dialog.className = 'isi-portal-confirm isi-improvement-progress'; dialog.dataset.isiOwned = '';
    dialog.setAttribute('aria-labelledby', 'isi-improvement-title');
    const title = document.createElement('h2'); title.id = 'isi-improvement-title'; title.textContent = 'Loading previous request';
    const message = document.createElement('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    const progress = createRequestProgress('Loading request fields and products');
    const actions = document.createElement('div'); actions.className = 'isi-dialog-actions';
    const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Reload page';
    reload.addEventListener('click', () => location.reload(), {signal: events.signal});
    actions.append(reload); actions.hidden = true;
    dialog.append(title, message, progress, actions);
    const focus = document.activeElement;
    dialog.addEventListener('cancel', event => event.preventDefault(), {signal: events.signal});
    document.body.append(dialog); dialog.showModal();
    surface = {dialog, title, message, progress, actions, focus};
    return surface;
  }
  function update(event) {
    const value = event.detail;
    if (!Number.isSafeInteger(value?.id) || value.id < current || !['loading', 'slow', 'complete', 'failed'].includes(value.state)) return;
    current = value.id;
    const view = show();
    if (value.state === 'loading') {
      view.message.textContent = value.total > 0
        ? `Loading the previous request’s fields and products… ${value.completed} of ${value.total} responses received.`
        : 'Loading the previous request’s fields and products…';
      return;
    }
    if (value.state === 'slow') {
      view.message.textContent = 'The portal is taking longer to respond. Please wait, or reload this page before editing.';
      view.actions.hidden = false;
      return;
    }
    const customer = document.querySelector('#sr_customer_id')?.value;
    if (value.state === 'complete' && customer && customer !== '0') {
      remove();
      onLoaded();
      notify('Previous request loaded. Review the fields before saving.', {key: 'improvement-loaded'});
      return;
    }
    view.title.textContent = 'Previous request could not be loaded';
    view.message.textContent = 'Some fields or products may be incomplete. Reload this page before continuing.';
    view.progress.hidden = true; view.actions.hidden = false;
    view.dialog.dataset.state = 'attention';
  }
  document.addEventListener('islandsun-improvement-loading', update, {signal: events.signal});
  return {destroy() { events.abort(); remove(); }};
}
