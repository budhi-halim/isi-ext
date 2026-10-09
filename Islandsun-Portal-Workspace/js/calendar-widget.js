(() => {
  const toUTC = date => date instanceof Date && Number.isFinite(date.valueOf())
    ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) : null;
  const toLocal = date => new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

  /** Both legacy libraries use the same jQuery data key; call the instance's owning library. */
  function calendarFor(input) {
    const $ = window.jQuery, instance = $?.(input).data('datepicker');
    if (!instance) return null;
    if (typeof instance.getStartDate === 'function') {
      return {
        start: () => Number(instance.getStartDate()), end: () => Number(instance.getEndDate()),
        date: () => instance.getUTCDate(), format: () => instance.getFormattedDate(),
        set: date => instance.setUTCDate(date), refresh: () => instance.update(),
        allowed(date) {
          if (!instance.dateWithinRange(date) || instance.dateIsDisabled(date)) return false;
          const result = instance.o.beforeShowDay?.(toLocal(date));
          return result !== false && result?.enabled !== false
            && !(typeof result === 'string' ? result : result?.classes || '').split(/\s+/).includes('disabled');
        },
      };
    }
    const manager = $.datepicker;
    if (!instance.settings || !instance.input || !manager?._getMinMaxDate) return null;
    // jQuery UI 1.12 is retained by the portal alongside Bootstrap's global plugin.
    // Its manager is needed here because $.fn.datepicker may belong to the other library.
    return {
      start: () => toUTC(manager._getMinMaxDate(instance, 'min'))?.valueOf() ?? -Infinity,
      end: () => toUTC(manager._getMinMaxDate(instance, 'max'))?.valueOf() ?? Infinity,
      date: () => toUTC(manager._getDateDatepicker(input)),
      format: () => manager._formatDate(instance),
      refresh: () => manager._getDateDatepicker(input),
      set(date) {
        manager._setDateDatepicker(input, toLocal(date));
        const selected = manager._get(instance, 'onSelect');
        if (typeof selected === 'function') selected.call(input, input.value, instance);
        else $(input).trigger('change');
      },
      allowed(date) {
        const local = toLocal(date);
        if (!manager._isInRange(instance, local)) return false;
        const callback = manager._get(instance, 'beforeShowDay');
        return !callback || Boolean(callback.call(input, local)?.[0]);
      },
    };
  }

  let missingDeliveryDays;
  /** Read the literal rule of the native missing selector, without executing or rewriting scripts. */
  function missingDeliveryStart(input) {
    if (input.id !== 'srd_datesample' || new URLSearchParams(location.search).get('srtype') !== '4'
      || document.getElementById('txt-date-of-sample')) return null;
    if (missingDeliveryDays === undefined) {
      const values = new Set();
      let unsupported = false;
      for (const script of document.scripts) {
        if (script.src) continue;
        const source = script.textContent;
        const calls = source.matchAll(/(?:\$|jQuery)\(\s*(['"])#txt-date-of-sample\1\s*\)\s*\.datepicker\(\s*\{([^{}]*)\}\s*\)/g);
        for (const [, , options] of calls) {
          if (!/\bminDate\s*:/.test(options)) continue;
          const keys = [...options.matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map(match => match[1]);
          const minimum = /(?:^|,)\s*minDate\s*:\s*(-?\d+)\s*(?:,|$)/.exec(options);
          if (!minimum || keys.some(key => !['minDate', 'autoclose', 'dateFormat'].includes(key))) { unsupported = true; continue; }
          const days = Number(minimum[1]);
          if (!Number.isSafeInteger(days) || Math.abs(days) > 100000) { unsupported = true; continue; }
          values.add(days);
        }
      }
      missingDeliveryDays = !unsupported && values.size === 1 ? [...values][0] : null;
    }
    if (missingDeliveryDays === null) return null;
    const today = new Date();
    return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + missingDeliveryDays);
  }

  Object.defineProperty(window, Symbol.for('islandsun.calendar-widget'), {
    value: Object.freeze({ calendarFor, missingDeliveryStart }), configurable: true,
  });
})();
