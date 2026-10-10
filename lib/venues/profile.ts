/**
 * The corporate venue profile: private dining suites, seating layouts,
 * cancellation terms and minimum-spend compliance, read from the venue's
 * profile columns (migration 0019) and the company's negotiated rate card.
 *
 * The JSON columns are parsed defensively: a malformed entry is dropped
 * rather than trusted. Pure: tests import it directly
 * (tests/corporate-venue-os.test.mjs).
 */

export const SEATING_LAYOUTS = ["banquet", "cocktail", "theatre", "boardroom", "classroom"] as const;
export type SeatingLayout = (typeof SEATING_LAYOUTS)[number];

export interface PrivateSuite {
  name: string;
  seats: number;
  min_spend_inr: number;
}

export interface LayoutCapacity {
  layout: SeatingLayout;
  capacity: number;
}

export interface CancellationTier {
  /** Cancelled at least this many days before the event… */
  days_before: number;
  /** …refunds this share of the booking total. */
  refund_pct: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
const money = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function parseSuites(raw: unknown): PrivateSuite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Obj => isObj(s) && typeof s.name === "string" && s.name.trim() !== "" && count(s.seats) && money(s.min_spend_inr))
    .map((s) => ({ name: (s.name as string).trim(), seats: s.seats as number, min_spend_inr: s.min_spend_inr as number }))
    .sort((a, b) => a.seats - b.seats);
}

export function parseLayouts(raw: unknown): LayoutCapacity[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Obj => isObj(l) && (SEATING_LAYOUTS as readonly unknown[]).includes(l.layout) && count(l.capacity))
    .map((l) => ({ layout: l.layout as SeatingLayout, capacity: l.capacity as number }))
    .sort((a, b) => b.capacity - a.capacity);
}

/** Tiers with the most notice first. */
export function parseCancellationTerms(raw: unknown): CancellationTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Obj => isObj(t) && Number.isInteger(t.days_before) && (t.days_before as number) >= 0 && typeof t.refund_pct === "number" && t.refund_pct >= 0 && t.refund_pct <= 100)
    .map((t) => ({ days_before: t.days_before as number, refund_pct: t.refund_pct as number }))
    .sort((a, b) => b.days_before - a.days_before);
}

const DAY_MS = 86_400_000;

/** Whole days from `on` (YYYY-MM-DD) to the event date (negative once it has passed). */
export function daysBefore(eventDate: string, on: string): number {
  return Math.round((Date.parse(`${eventDate}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / DAY_MS);
}

/**
 * What a cancellation on `on` refunds: the first tier whose notice period is
 * met. Without any tiers the venue's terms are unknown, so nothing is promised.
 */
export function refundFor(terms: CancellationTier[], eventDate: string, on: string, total: number): { refundPct: number; refund: number; tier: CancellationTier | null } {
  const notice = daysBefore(eventDate, on);
  const tier = terms.find((t) => notice >= t.days_before) ?? null;
  const refundPct = tier?.refund_pct ?? 0;
  return { refundPct, refund: Math.round(total * refundPct) / 100, tier };
}

/** "Full refund 14+ days before · 50% refund 7–13 days before · no refund under 7 days" */
export function describeCancellation(terms: CancellationTier[]): string {
  if (terms.length === 0) return "Terms on request";
  const pct = (p: number) => (p === 100 ? "full refund" : p === 0 ? "no refund" : `${p}% refund`);
  const parts = terms.map((t, i) => {
    const upper = i === 0 ? null : terms[i - 1].days_before - 1;
    return `${pct(t.refund_pct)} ${upper === null || upper <= t.days_before ? `${t.days_before}+` : `${t.days_before}–${upper}`} days before`;
  });
  const last = terms[terms.length - 1];
  if (last.refund_pct > 0 && last.days_before > 0) parts.push(`no refund under ${last.days_before} days`);
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface MinSpendInput {
  partySize: number;
  /** Pre-GST per head the company will pay (after its rate card). */
  perHead: number;
  /** Venue-wide minimum (or the rate card's override). */
  minimumSpend: number;
  /** Minimum per guest (venues.min_spend_per_head_inr; 0 = none). */
  minimumPerHead: number;
}

export interface MinSpendCompliance {
  ok: boolean;
  total: number;
  /** The binding minimum: the larger of the venue-wide and per-guest minimums. */
  required: number;
  /** How much more is needed to comply (0 when compliant). */
  shortfall: number;
  /** Which minimum binds. */
  basis: "total" | "per_head" | "none";
}

export function minSpendCompliance({ partySize, perHead, minimumSpend, minimumPerHead }: MinSpendInput): MinSpendCompliance {
  const total = Math.round(partySize * perHead * 100) / 100;
  const perHeadFloor = Math.round(partySize * minimumPerHead * 100) / 100;
  const required = Math.max(minimumSpend, perHeadFloor);
  const basis = required === 0 ? "none" : perHeadFloor > minimumSpend ? "per_head" : "total";
  const shortfall = Math.max(0, Math.round((required - total) * 100) / 100);
  return { ok: shortfall === 0, total, required, shortfall, basis };
}

/** Layouts that seat the party, roomiest fit first; suites that hold it, smallest first. */
export function seatingFor(partySize: number, layouts: LayoutCapacity[], suites: PrivateSuite[]) {
  return {
    layouts: layouts.filter((l) => l.capacity >= partySize).sort((a, b) => a.capacity - b.capacity),
    suites: suites.filter((s) => s.seats >= partySize),
  };
}

/** A negotiated discount in the enterprise band the platform targets (10–15%). */
export const isEnterpriseRate = (discountPct: number) => discountPct >= 10 && discountPct <= 15;
