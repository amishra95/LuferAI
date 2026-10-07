/**
 * Partner extranet input rules and rate-card logic. Pure (tested in
 * tests/partner-extranet.test.mjs); mirrors the CHECK constraints in
 * supabase/migrations/20261008100100_partner_extranet.sql so users see field
 * errors instead of database errors.
 */
import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} needs at least ${min} characters`).max(max, `${label} is at most ${max} characters`);

export const listingSchema = z.object({
  ref: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, "Use up to 32 letters, digits, dots, dashes or underscores"),
  name: text(2, 120, "Name"),
  area: text(2, 80, "Area"),
  city: text(2, 80, "City"),
  address: z.string().trim().max(200, "Address is at most 200 characters").default(""),
  capacity: z.coerce.number().int("Whole guests only").min(1, "At least 1 guest").max(5000, "At most 5,000 guests"),
  min_spend_inr: z.coerce.number().min(0, "Can't be negative").max(1e9, "Too large"),
  private_dining: z.boolean().default(false),
});
export type ListingInput = z.infer<typeof listingSchema>;

export const rateCardSchema = z
  .object({
    partner_venue_id: z.uuid("Choose a listing"),
    label: text(2, 80, "Label"),
    per_head_inr: z.coerce.number().positive("Enter a per-head rate").max(1e6, "Too large"),
    min_guests: z.coerce.number().int("Whole guests only").min(1, "At least 1 guest").max(5000, "At most 5,000 guests"),
    valid_from: z.string().regex(ISO_DATE, "Pick a start date"),
    valid_to: z
      .string()
      .regex(ISO_DATE, "Pick an end date")
      .nullable()
      .default(null),
  })
  .refine((r) => r.valid_to == null || r.valid_to >= r.valid_from, { path: ["valid_to"], message: "Ends before it starts" });
export type RateCardInput = z.infer<typeof rateCardSchema>;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** zod issues → one message per field (first wins). */
export function fieldErrorsOf<K extends string>(error: z.ZodError): FieldErrors<K> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out as FieldErrors<K>;
}

export interface RateWindow {
  id: string;
  partner_venue_id: string;
  per_head_inr: number;
  min_guests: number;
  valid_from: string;
  valid_to: string | null;
}

export const isRateActiveOn = (r: Pick<RateWindow, "valid_from" | "valid_to">, date: string) =>
  r.valid_from <= date && (r.valid_to == null || date <= r.valid_to);

/**
 * Rate cards of the same listing whose validity overlaps `card` and that apply
 * to the same group size bracket start (min_guests). Overlaps are allowed
 * across brackets (e.g. a 50+ rate alongside the base rate), not within one,
 * so a date never has two competing prices.
 */
export function overlappingRates<T extends RateWindow>(existing: readonly T[], card: Omit<RateWindow, "id"> & { id?: string }): T[] {
  const end = (d: string | null) => d ?? "9999-12-31";
  return existing.filter(
    (r) =>
      r.id !== card.id &&
      r.partner_venue_id === card.partner_venue_id &&
      r.min_guests === card.min_guests &&
      r.valid_from <= end(card.valid_to) &&
      card.valid_from <= end(r.valid_to)
  );
}

/**
 * The per-head price a listing quotes for a group on a date: among rates active
 * that day, the most specific bracket the group qualifies for (highest
 * min_guests ≤ guests). Null when no rate applies.
 */
export function quotePerHead(rates: readonly RateWindow[], listingId: string, date: string, guests = 1): number | null {
  const candidates = rates
    .filter((r) => r.partner_venue_id === listingId && isRateActiveOn(r, date) && r.min_guests <= guests)
    .sort((a, b) => b.min_guests - a.min_guests || a.per_head_inr - b.per_head_inr);
  return candidates[0]?.per_head_inr ?? null;
}

/** "From ₹x/head" for a listing on a date: the cheapest active rate across brackets. */
export function fromPerHead(rates: readonly RateWindow[], listingId: string, date: string): number | null {
  const active = rates.filter((r) => r.partner_venue_id === listingId && isRateActiveOn(r, date)).map((r) => r.per_head_inr);
  return active.length ? Math.min(...active) : null;
}
