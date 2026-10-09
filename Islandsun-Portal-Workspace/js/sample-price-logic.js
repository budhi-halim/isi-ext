(() => {
  function samplePrice(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    // The portal returns an unformatted decimal. Reject login HTML, blanks and
    // locale separators instead of interpreting them as a usable price.
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) return null;
    return { marketing: text, ideal: /^0+(?:\.0+)?$/.test(text) ? '5' : text };
  }

  window[Symbol.for('islandsun.sample-price')] = Object.freeze({ samplePrice });
})();
