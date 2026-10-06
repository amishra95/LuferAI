/** Indian financial-year helpers (pure; tested in tests/fiscal-year.test.mjs). */

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Indian financial year (1 Apr – 31 Mar) containing `date` (YYYY-MM-DD). */
export function financialYear(date: string): { start: string; end: string; label: string } {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    label: `FY${String(startYear).slice(2)}–${String(startYear + 1).slice(2)}`,
  };
}
