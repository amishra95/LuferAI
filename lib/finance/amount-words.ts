/**
 * An INR amount in words, the Indian way (lakh, crore), as printed on tax
 * invoices: 118000 → "Rupees One Lakh Eighteen Thousand Only".
 * Pure: tests import it directly.
 */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", below100(n % 100)].filter(Boolean).join(" ");
}

function whole(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  // Crores can themselves run past 99 (₹100 crore and up).
  if (crore) parts.push(`${crore > 999 ? whole(crore) : below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

export function amountInWords(inr: number): string {
  const paise = Math.round(Math.abs(inr) * 100);
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${whole(rupees)}${p ? ` and ${below100(p)} Paise` : ""} Only`;
}
