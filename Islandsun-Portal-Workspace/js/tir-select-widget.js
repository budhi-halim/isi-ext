(() => {
  if (!/^\/islandsun\/(?:index\.php\/)?master\/tir(?:\/|$)/i.test(location.pathname)) return;
  const PAGE_SIZE = 100;
  let installed, originalOptions;

  function configure() {
    const $ = window.jQuery, select = document.querySelector('#setsrf');
    const instance = $?.fn.select2 && $(select).data('select2');
    if (!instance || !select) return;
    const enabled = document.documentElement.dataset.isiPortal === 'enabled';
    if (installed === instance && enabled) return;
    if (!enabled) {
      if (installed === instance) { $(select).select2('destroy').select2(originalOptions); installed = null; originalOptions = null; }
      return;
    }
    const amd = $.fn.select2.amd;
    if (!amd || instance.options.get('ajax') || instance.options.get('multiple')) return;
    const Utils = amd.require('select2/utils');
    const Select = amd.require('select2/data/select');
    const Results = amd.require('select2/results');

    function PagedData(element, options) {
      Select.call(this, element, options);
      this.cache = null;
      this.observer = new MutationObserver(() => { this.cache = null; });
      this.observer.observe(element[0], { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value','label','disabled'] });
    }
    Utils.Extend(PagedData, Select);
    PagedData.prototype.query = function (params, callback) {
      const term = params.term || '';
      const render = data => {
        const reopening = !this.cache && !term && params.page === undefined;
        const selectedIndex = reopening ? data.results.findIndex(item => String(item.id) === String(this.$element.val())) : -1;
        const initialPage = selectedIndex < 0 ? 1 : Math.floor(selectedIndex / PAGE_SIZE) + 1;
        this.cache = { term, data };
        const pages = Math.max(1, Math.ceil(data.results.length / PAGE_SIZE));
        const page = Math.min(pages, Math.max(1, Math.floor(Number(params.page) || initialPage)));
        callback({ results: data.results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), isiPage: { page, pages, term } });
      };
      if (this.cache?.term === term) render(this.cache.data);
      else Select.prototype.query.call(this, params, render);
    };
    PagedData.prototype.destroy = function () {
      this.observer.disconnect(); this.cache = null;
      Select.prototype.destroy.call(this);
    };
    function PagedResults(element, options, data) { Results.call(this, element, options, data); }
    Utils.Extend(PagedResults, Results);
    PagedResults.prototype.bind = function (container, wrapper) {
      Results.prototype.bind.call(this, container, wrapper);
      this.container = container;
      this.$results.on('click.isiPages', '[data-isi-request-page]', event => {
        event.preventDefault(); event.stopPropagation();
        const page = Number(event.currentTarget.dataset.isiRequestPage);
        container.trigger('query', { term: this.pageState.term, page });
        container.dropdown.$search?.trigger('focus');
      });
      this.$results.on('keydown.isiPages', event => {
        if (!['PageDown','PageUp'].includes(event.key)) return;
        this.turnPage(event);
      });
      this.keyHandler = event => {
        if (container.isOpen() && event.target.matches('.select2-search__field') && ['PageDown','PageUp'].includes(event.key)) this.turnPage(event);
      };
      this.keyUpHandler = event => {
        if (container.isOpen() && event.target.matches('.select2-search__field') && ['PageDown','PageUp'].includes(event.key)) event.stopImmediatePropagation();
      };
      document.addEventListener('keydown', this.keyHandler, true);
      document.addEventListener('keyup', this.keyUpHandler, true);
      container.on('close', () => { this.data.cache = null; });
    };
    PagedResults.prototype.turnPage = function (event) {
      if (!this.pageState) return;
      event.preventDefault(); event.stopPropagation();
      const { page, pages, term } = this.pageState;
      const next = Math.max(1, Math.min(pages, page + (event.key === 'PageDown' ? 1 : -1)));
      if (next !== page) this.container.trigger('query', { term, page: next });
    };
    PagedResults.prototype.append = function (data) {
      Results.prototype.append.call(this, data);
      this.pageState = data.isiPage;
      if (!this.pageState || this.pageState.pages <= 1) return;
      const { page, pages } = this.pageState;
      const footer = document.createElement('li'); footer.className = 'isi-request-pages'; footer.setAttribute('role','presentation');
      for (const [label, target] of [['Previous',page - 1],['Next',page + 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.dataset.isiRequestPage = String(target); button.disabled = target < 1 || target > pages;
        button.setAttribute('aria-label', `${label} request options`); footer.append(button);
        if (label === 'Previous') { const count = document.createElement('span'); count.textContent = `${page} / ${pages}`; footer.append(count); }
      }
      this.$results.append(footer);
    };
    PagedResults.prototype.destroy = function () {
      document.removeEventListener('keydown', this.keyHandler, true);
      document.removeEventListener('keyup', this.keyUpHandler, true);
      this.$results.off('.isiPages'); Results.prototype.destroy.call(this);
    };
    originalOptions = { ...instance.options.options };
    $(select).select2('destroy').select2({ ...originalOptions, dataAdapter: PagedData, resultsAdapter: PagedResults });
    installed = $(select).data('select2');
  }
  document.addEventListener('islandsun-portal-ready', configure);
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Element && event.target.closest('.select2-container')) configure();
  }, true);
  new MutationObserver(configure).observe(document.documentElement, { attributes: true, attributeFilter: ['data-isi-portal'] });
})();
