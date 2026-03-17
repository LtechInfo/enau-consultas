(function () {
  const stripAccents = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const normalizeKey = (value) =>
    stripAccents(value)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const valueToString = (value) => (value === null || value === undefined ? '' : String(value).trim());
  const normalizeUsername = (value) => valueToString(value).toLowerCase();
  const normalizeRa = (value) => valueToString(value).replace(/\.0+$/, '');
  const normalizeTurno = (value) => {
    const v = valueToString(value).toUpperCase();
    if (!v) return 'V';
    if (v === 'INTEGRAL') return 'MeV';
    if (v === 'MATUTINO') return 'M';
    if (v === 'VESPERTINO') return 'V';
    return v;
  };
  const normalizeTipo = (value) => {
    const v = valueToString(value).toUpperCase();
    if (!v) return 'VETERANO';
    if (v.includes('CALOU')) return 'CALOURO';
    if (v.includes('VETER')) return 'VETERANO';
    return v;
  };
  const normText = (value) => stripAccents(valueToString(value)).toLowerCase();

  const notEmpty = (value) => valueToString(value) !== '';

  const mergeWithoutEmptyOverwrite = (existing, incoming) => {
    const merged = { ...(existing || {}) };
    Object.entries(incoming || {}).forEach(([key, value]) => {
      if (notEmpty(value)) merged[key] = value;
    });
    return merged;
  };

  window.ENAU_UTILS = Object.assign(window.ENAU_UTILS || {}, {
    stripAccents,
    normalizeKey,
    valueToString,
    normalizeUsername,
    normalizeRa,
    normalizeTurno,
    normalizeTipo,
    normText,
    notEmpty,
    mergeWithoutEmptyOverwrite
  });
})();
