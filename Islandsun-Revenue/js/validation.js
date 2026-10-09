export function validateMonths(start, end) {
  const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1000;
  if (!validMonth(start) || !validMonth(end)) return 'Select both the first and last month.';
  if (start > end) return 'The last month must be the same as or after the first month.';
  return '';
}
