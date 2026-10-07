/**
 * Deterministic reservation-text parser for chat channels. Used when no model
 * is configured (demo mode) and to pre-fill context otherwise. Pure: no
 * server/framework imports, so tests/channels.test.mjs can run it directly.
 */

export interface ParsedReservation {
  intent: "book" | "search";
  guests?: number;
  /** YYYY-MM-DD */
  date?: string;
  budgetPerHead?: number;
  /** A catalogue neighbourhood named in the text. */
  area?: string;
  /** A catalogue venue named in the text. */
  venueName?: string;
  wantsPrivateDining: boolean;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function isValidDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function addDays(today: string, days: number): string {
  const dt = new Date(`${today}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Day + month without a year means the next such date on or after today. */
function nextOccurrence(today: string, month: number, day: number): string | undefined {
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    if (isValidDate(y, month, day) && iso(y, month, day) >= today) return iso(y, month, day);
  }
  return undefined;
}

/** Returns the parsed date and the matched text (so its digits aren't read as a guest count). */
function parseDate(text: string, today: string): { date?: string; match?: string } {
  const t = text.toLowerCase();
  let m = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m && isValidDate(+m[1], +m[2], +m[3])) return { date: iso(+m[1], +m[2], +m[3]), match: m[0] };

  // India is day-first: 20/11/2026, 20-11-26.
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (isValidDate(y, +m[2], +m[1])) return { date: iso(y, +m[2], +m[1]), match: m[0] };
  }

  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(20\\d{2}))?\\b`));
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3)) + 1;
    const date = m[3] ? (isValidDate(+m[3], month, +m[1]) ? iso(+m[3], month, +m[1]) : undefined) : nextOccurrence(today, month, +m[1]);
    if (date) return { date, match: m[0] };
  }
  m = t.match(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`));
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3)) + 1;
    const date = m[3] ? (isValidDate(+m[3], month, +m[2]) ? iso(+m[3], month, +m[2]) : undefined) : nextOccurrence(today, month, +m[2]);
    if (date) return { date, match: m[0] };
  }

  if (/\btomorrow\b/.test(t)) return { date: addDays(today, 1), match: "tomorrow" };
  if (/\bday after tomorrow\b/.test(t)) return { date: addDays(today, 2), match: "day after tomorrow" };
  return {};
}

const toNumber = (s: string) => Number(s.replace(/,/g, ""));

export function parseReservationText(
  text: string,
  catalogue: { venueNames: string[]; areas: string[] },
  today: string
): ParsedReservation {
  const lower = text.toLowerCase();
  let rest = lower;

  const { date, match: dateText } = parseDate(text, today);
  if (dateText) rest = rest.replace(dateText, " ");

  // "₹2,500 a head", "2500 per head", "rs 1800/pp", "₹2.5k per person"
  let budgetPerHead: number | undefined;
  const budget = rest.match(/(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\/|per|a|an)\s*(?:head|person|pax|pp|guest)\b|(?:₹|rs\.?|inr)\s*([\d,]+)\s*(k)?\s*pp\b/);
  if (budget) {
    const raw = budget[1] ?? budget[3];
    const k = budget[2] ?? budget[4];
    budgetPerHead = Math.round(toNumber(raw) * (k ? 1000 : 1));
    rest = rest.replace(budget[0], " ");
  }

  let guests: number | undefined;
  const g =
    rest.match(/\b(\d{1,4})\s*(?:people|persons|guests|pax|covers|attendees|ppl|of us|heads)\b/) ??
    rest.match(/\b(?:for|party of|group of|team of)\s+(\d{1,4})\b/);
  if (g) guests = Number(g[1]);

  const venueName = [...catalogue.venueNames]
    .sort((a, b) => b.length - a.length)
    .find((v) => lower.includes(v.toLowerCase()) || lower.includes(v.toLowerCase().replace(/^the\s+/, "")));
  const area = catalogue.areas.find((a) => lower.includes(a.toLowerCase()));

  return {
    intent: /\b(book|reserve|confirm|lock in|hold)\b/.test(lower) ? "book" : "search",
    guests,
    date,
    budgetPerHead,
    area,
    venueName,
    wantsPrivateDining: /private (dining|room)|\bpdr\b|private space/.test(lower),
  };
}

/** Current message's details win; gaps are filled from earlier turns (newest first). */
export function mergeParsed(current: ParsedReservation, earlier: ParsedReservation[]): ParsedReservation {
  const pick = <K extends keyof ParsedReservation>(k: K) => current[k] ?? earlier.find((p) => p[k] !== undefined)?.[k];
  const wantedBooking = earlier.some((p) => p.intent === "book");
  return {
    intent: current.intent === "book" || (wantedBooking && !current.area) ? "book" : "search",
    guests: pick("guests"),
    date: pick("date"),
    budgetPerHead: pick("budgetPerHead"),
    area: pick("area"),
    venueName: pick("venueName"),
    wantsPrivateDining: current.wantsPrivateDining || earlier.some((p) => p.wantsPrivateDining),
  };
}
