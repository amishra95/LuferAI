/**
 * A venue's own pricing controls (venue_pricing_rules, migration 0027), set by the
 * host on /property → Pricing:
 *
 *   guest-count tiers   a per-head adjustment by party size (−5% for 41–100 guests)
 *   rate calendar       weekend surcharges and peak-season / high-demand multipliers
 *   deposit             the share authorised when a client books (default 25%)
 *   AI locks            terms the AI negotiator may not change
 *
 * `priceFor` turns a package's list price into the venue's price for one event:
 * list × (1 + tier adjustment) × the calendar multiplier in force on the date.
 * That is the venue's "own price" everywhere it's quoted: instant quotes,
 * auto-counter/decline, and the baseline the discount ceiling is measured from.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/venue-pricing.test.mjs).
 */
import { DEPOSIT_RATE } from "../quotes.ts";
import type { CancellationTier } from "../venues/profile.ts";

export const MULTIPLIER_KINDS = ["weekend", "peak_season", "high_demand"] as const;
export type MultiplierKind = (typeof MULTIPLIER_KINDS)[number];

export const MULTIPLIER_KIND_LABEL: Record<MultiplierKind, string> = {
  weekend: "Weekend surcharge",
  peak_season: "Peak season",
  high_demand: "High-demand dates",
};

export const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface GuestTier {
  min_guests: number;
  /** Inclusive; null = no upper bound. */
  max_guests: number | null;
  /** Per-head adjustment in percent: −5 is 5% off, 10 is 10% more. */
  adjustment_pct: number;
}

export interface RateMultiplier {
  id: string;
  kind: MultiplierKind;
  label: string;
  /** Weekend surcharges: days of the week it applies (0 = Sunday). Empty for date ranges. */
  weekdays: number[];
  /** Peak seasons and high-demand dates: inclusive YYYY-MM-DD range. Null for weekends. */
  starts_on: string | null;
  ends_on: string | null;
  multiplier: number;
}

export interface VenuePricing {
  /** Deposit percent; null = the platform default. */
  depositPct: number | null;
  tiers: GuestTier[];
  multipliers: RateMultiplier[];
  /** The AI negotiator may not change the minimum spend. */
  lockMinSpend: boolean;
  /** Menu packages the AI negotiator may not change. */
  lockedPackageIds: string[];
}

export const NO_PRICING: VenuePricing = { depositPct: null, tiers: [], multipliers: [], lockMinSpend: false, lockedPackageIds: [] };

export const PRICING_LIMITS = {
  maxTiers: 6,
  /** Tier adjustments: up to 50% off, up to double. */
  minAdjustmentPct: -50,
  maxAdjustmentPct: 100,
  maxMultipliers: 30,
  minMultiplier: 0.5,
  maxMultiplier: 3,
  /** Longest single peak-season / high-demand range. */
  maxRangeDays: 366,
  maxCancellationTiers: 5,
} as const;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Day of the week (0 = Sunday) of a YYYY-MM-DD date. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

// ----------------------------------------------------------------------------
// Reading stored rows (defensive: malformed entries are dropped, not trusted)
// ----------------------------------------------------------------------------

export function parseGuestTiers(raw: unknown): GuestTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is Obj =>
        isObj(t) &&
        Number.isInteger(t.min_guests) &&
        (t.min_guests as number) >= 1 &&
        (t.max_guests === null || (Number.isInteger(t.max_guests) && (t.max_guests as number) >= (t.min_guests as number))) &&
        typeof t.adjustment_pct === "number" &&
        t.adjustment_pct >= PRICING_LIMITS.minAdjustmentPct &&
        t.adjustment_pct <= PRICING_LIMITS.maxAdjustmentPct
    )
    .map((t) => ({ min_guests: t.min_guests as number, max_guests: t.max_guests as number | null, adjustment_pct: t.adjustment_pct as number }))
    .sort((a, b) => a.min_guests - b.min_guests);
}

export function parseRateMultipliers(raw: unknown): RateMultiplier[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m): RateMultiplier[] => {
    if (!isObj(m) || typeof m.id !== "string" || !(MULTIPLIER_KINDS as readonly unknown[]).includes(m.kind)) return [];
    if (typeof m.multiplier !== "number" || m.multiplier < PRICING_LIMITS.minMultiplier || m.multiplier > PRICING_LIMITS.maxMultiplier) return [];
    const label = typeof m.label === "string" ? m.label.trim() : "";
    if (m.kind === "weekend") {
      const days = Array.isArray(m.weekdays) ? [...new Set(m.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
      if (days.length === 0) return [];
      return [{ id: m.id, kind: "weekend", label, weekdays: days, starts_on: null, ends_on: null, multiplier: m.multiplier }];
    }
    if (!isIsoDate(m.starts_on) || !isIsoDate(m.ends_on) || m.ends_on < m.starts_on) return [];
    return [{ id: m.id, kind: m.kind as MultiplierKind, label, weekdays: [], starts_on: m.starts_on, ends_on: m.ends_on, multiplier: m.multiplier }];
  });
}

// ----------------------------------------------------------------------------
// Validating the host's forms (strings from inputs)
// ----------------------------------------------------------------------------

const num = (s: string) => {
  const t = s.trim().replace(/[₹,%\s]/g, "");
  return t === "" ? null : Number(t);
};

/** Guest-count tiers from the form's rows; fully blank rows are ignored. Bands may not overlap. */
export function parseTierRows(rows: { min: string; max: string; pct: string }[]): Result<GuestTier[]> {
  const tiers: GuestTier[] = [];
  for (const [i, row] of rows.entries()) {
    const min = num(row.min);
    const max = num(row.max);
    const pct = num(row.pct);
    if (min === null && max === null && pct === null) continue;
    const n = `Tier ${i + 1}`;
    if (min === null || !Number.isInteger(min) || min < 1) return { ok: false, error: `${n}: enter the smallest party size, a whole number from 1.` };
    if (max !== null && (!Number.isInteger(max) || max < min)) return { ok: false, error: `${n}: the largest party size must be a whole number of at least ${min}, or blank for no limit.` };
    if (pct === null || !Number.isFinite(pct) || pct < PRICING_LIMITS.minAdjustmentPct || pct > PRICING_LIMITS.maxAdjustmentPct) {
      return { ok: false, error: `${n}: the adjustment must be between ${PRICING_LIMITS.minAdjustmentPct}% and +${PRICING_LIMITS.maxAdjustmentPct}%.` };
    }
    tiers.push({ min_guests: min, max_guests: max, adjustment_pct: round2(pct) });
  }
  if (tiers.length > PRICING_LIMITS.maxTiers) return { ok: false, error: `Use at most ${PRICING_LIMITS.maxTiers} tiers.` };
  tiers.sort((a, b) => a.min_guests - b.min_guests);
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1];
    if (prev.max_guests === null || prev.max_guests >= tiers[i].min_guests) {
      return { ok: false, error: `The ${bandLabel(prev)} and ${bandLabel(tiers[i])} guest tiers overlap. Each party size may fall in one tier only.` };
    }
  }
  return { ok: true, value: tiers };
}

/** One rate-calendar entry from the add form. */
export function parseMultiplierForm(
  input: { kind: string; label: string; weekdays: string[]; startsOn: string; endsOn: string; multiplier: string },
  id: string
): Result<RateMultiplier> {
  if (!(MULTIPLIER_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: "Choose what kind of rate this is." };
  const kind = input.kind as MultiplierKind;
  const factor = num(input.multiplier.replace(/^[x×]/i, ""));
  if (factor === null || !Number.isFinite(factor) || factor < PRICING_LIMITS.minMultiplier || factor > PRICING_LIMITS.maxMultiplier) {
    return { ok: false, error: `The multiplier must be between ×${PRICING_LIMITS.minMultiplier} and ×${PRICING_LIMITS.maxMultiplier} (×1.2 is 20% more).` };
  }
  const label = input.label.trim().slice(0, 60) || MULTIPLIER_KIND_LABEL[kind];
  const multiplier = round2(factor);
  if (kind === "weekend") {
    const days = [...new Set(input.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (days.length === 0) return { ok: false, error: "Pick the days the weekend rate applies to." };
    return { ok: true, value: { id, kind, label, weekdays: days, starts_on: null, ends_on: null, multiplier } };
  }
  const startsOn = input.startsOn.trim();
  const endsOn = input.endsOn.trim() || startsOn;
  if (!isIsoDate(startsOn) || !isIsoDate(endsOn)) return { ok: false, error: "Pick the dates this rate applies to." };
  if (endsOn < startsOn) return { ok: false, error: "The end date is before the start date." };
  const days = Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / DAY_MS) + 1;
  if (days > PRICING_LIMITS.maxRangeDays) return { ok: false, error: `One range may cover at most ${PRICING_LIMITS.maxRangeDays} days.` };
  return { ok: true, value: { id, kind, label, weekdays: [], starts_on: startsOn, ends_on: endsOn, multiplier } };
}

/** Deposit percent from the form; blank = the platform default. */
export function parseDepositPct(text: string): Result<number | null> {
  const pct = num(text);
  if (pct === null) return { ok: true, value: null };
  // payments.deposit_rate must be positive: every booking takes some deposit.
  if (!Number.isFinite(pct) || pct < 1 || pct > 100) return { ok: false, error: "The deposit must be between 1% and 100%, or blank for the platform default." };
  return { ok: true, value: round2(pct) };
}

/**
 * Cancellation tiers from the form's rows (fully blank rows ignored): each a
 * notice period in days and the refund it earns. More notice may never refund less.
 */
export function parseCancellationRows(rows: { days: string; pct: string }[]): Result<CancellationTier[]> {
  const tiers: CancellationTier[] = [];
  for (const [i, row] of rows.entries()) {
    const days = num(row.days);
    const pct = num(row.pct);
    if (days === null && pct === null) continue;
    const n = `Cancellation rule ${i + 1}`;
    if (days === null || !Number.isInteger(days) || days < 0 || days > 365) return { ok: false, error: `${n}: enter the notice in whole days (0–365).` };
    if (pct === null || !Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: `${n}: the refund must be between 0% and 100%.` };
    tiers.push({ days_before: days, refund_pct: round2(pct) });
  }
  if (tiers.length > PRICING_LIMITS.maxCancellationTiers) return { ok: false, error: `Use at most ${PRICING_LIMITS.maxCancellationTiers} cancellation rules.` };
  tiers.sort((a, b) => b.days_before - a.days_before);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].days_before === tiers[i - 1].days_before) return { ok: false, error: `Two rules use ${tiers[i].days_before} days' notice.` };
    if (tiers[i].refund_pct > tiers[i - 1].refund_pct) {
      return { ok: false, error: `Cancelling ${tiers[i].days_before} days before can't refund more than cancelling ${tiers[i - 1].days_before} days before.` };
    }
  }
  return { ok: true, value: tiers };
}

// ----------------------------------------------------------------------------
// Applying them
// ----------------------------------------------------------------------------

export const bandLabel = (t: Pick<GuestTier, "min_guests" | "max_guests">) => (t.max_guests === null ? `${t.min_guests}+` : t.min_guests === t.max_guests ? `${t.min_guests}` : `${t.min_guests}–${t.max_guests}`);

export function tierFor(tiers: GuestTier[], partySize: number): GuestTier | null {
  return tiers.find((t) => partySize >= t.min_guests && (t.max_guests === null || partySize <= t.max_guests)) ?? null;
}

export function multiplierApplies(m: RateMultiplier, date: string): boolean {
  if (m.kind === "weekend") return m.weekdays.includes(weekdayOf(date));
  return m.starts_on !== null && m.ends_on !== null && date >= m.starts_on && date <= m.ends_on;
}

/**
 * The calendar rate in force on a date: the largest multiplier that applies
 * (a peak-season weekend gets the larger of the two, not both). Without a date
 * nothing applies.
 */
export function multiplierFor(multipliers: RateMultiplier[], date: string | null): { multiplier: number; rule: RateMultiplier | null } {
  if (!date || !isIsoDate(date)) return { multiplier: 1, rule: null };
  let rule: RateMultiplier | null = null;
  for (const m of multipliers) if (multiplierApplies(m, date) && m.multiplier > (rule?.multiplier ?? 1)) rule = m;
  // Discounting multipliers (below ×1) apply only when nothing raises the rate.
  if (!rule) for (const m of multipliers) if (multiplierApplies(m, date) && m.multiplier < (rule?.multiplier ?? 1)) rule = m;
  return { multiplier: rule?.multiplier ?? 1, rule };
}

export interface VenuePrice {
  /** The venue's price for this event, rounded to the rupee. */
  perHead: number;
  /** The package's list price it started from. */
  listPerHead: number;
  tier: GuestTier | null;
  multiplier: number;
  rule: RateMultiplier | null;
  /** "Weekend surcharge ×1.2 · 41–100 guests −5%", or null when nothing applied. */
  note: string | null;
}

const signed = (pct: number) => `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;

/** A package's list price → this venue's price for a party size and date. */
export function priceFor(listPerHead: number, event: { partySize: number; date: string | null }, pricing: Pick<VenuePricing, "tiers" | "multipliers">): VenuePrice {
  const tier = tierFor(pricing.tiers, event.partySize);
  const { multiplier, rule } = multiplierFor(pricing.multipliers, event.date);
  const perHead = Math.round(listPerHead * (1 + (tier?.adjustment_pct ?? 0) / 100) * multiplier);
  const parts = [
    rule ? `${rule.label} ×${rule.multiplier}` : null,
    tier && tier.adjustment_pct !== 0 ? `${bandLabel(tier)} guests ${signed(tier.adjustment_pct)}` : null,
  ].filter(Boolean);
  return { perHead, listPerHead, tier, multiplier, rule, note: parts.length ? parts.join(" · ") : null };
}

/** Deposit as a fraction of the invoice total. */
export const depositRateFor = (pricing: Pick<VenuePricing, "depositPct"> | null | undefined) =>
  pricing?.depositPct == null ? DEPOSIT_RATE : pricing.depositPct / 100;

/** "Fri, Sat ×1.2" / "20 Dec – 5 Jan ×1.5", for lists. */
export function describeMultiplier(m: RateMultiplier): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const when = m.kind === "weekend" ? m.weekdays.map((d) => WEEKDAY_LABEL[d]).join(", ") : m.starts_on === m.ends_on ? fmt(m.starts_on!) : `${fmt(m.starts_on!)} – ${fmt(m.ends_on!)}`;
  return `${when} ×${m.multiplier}`;
}
