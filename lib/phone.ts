/**
 * Phone numbers, stored E.164 (+91…) for SMS and WhatsApp. Pure (no server
 * imports): the browser, server actions and tests share it.
 */

/**
 * Indian numbers in any common spelling (98450 12345, +91-98450-12345,
 * 098450 12345) become +91XXXXXXXXXX; other international numbers must start
 * with + and a country code. Returns null when it isn't a phone number.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  const local = digits.replace(/^0/, "");
  if (/^[6-9]\d{9}$/.test(local)) return `+91${local}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}
