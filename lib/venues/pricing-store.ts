import "server-only";

import { menuPackageRules } from "@/lib/guardrails/engine";
import { upsertMenuPackageInput } from "@/lib/guardrails/schemas";
import { depositRateFor, NO_PRICING, parseGuestTiers, parseRateMultipliers, type VenuePricing } from "@/lib/rates/venue-pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { CancellationTier } from "@/lib/venues/profile";

/**
 * The host's manual pricing controls on /property → Pricing:
 *
 * - venue_pricing_rules (migration 0027): deposit, guest-count tiers, rate
 *   calendar and AI locks. Before the migration every venue reads as having
 *   none and saving explains why it can't.
 * - venues: minimum spend, per-guest minimum, cancellation tiers.
 * - venue_menu_packages: the host's own package edits.
 *
 * Writes go through the service role, scoped to the acting venue by the caller
 * (app/(dashboard)/property/actions.ts never trusts a submitted venue id for
 * property managers).
 */

const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export const PRICING_UNAVAILABLE = "Pricing rules need database migration 0027 (venue_pricing_rules). Ask an admin to apply it.";

/** A host-facing refusal: its message is shown on the form. */
export class PricingError extends Error {}

type Row = {
  venue_id: string;
  deposit_pct: number | null;
  guest_tiers: Json;
  rate_multipliers: Json;
  lock_min_spend: boolean;
  locked_package_ids: string[];
};

const fromRow = (r: Row): VenuePricing => ({
  depositPct: r.deposit_pct === null ? null : Number(r.deposit_pct),
  tiers: parseGuestTiers(r.guest_tiers),
  multipliers: parseRateMultipliers(r.rate_multipliers),
  lockMinSpend: r.lock_min_spend,
  lockedPackageIds: r.locked_package_ids ?? [],
});

/** A venue's pricing rules, and whether they can be stored here at all. */
export async function getVenuePricing(venueId: string): Promise<{ pricing: VenuePricing; ready: boolean }> {
  const { data, error } = await createAdminClient().from("venue_pricing_rules").select("*").eq("venue_id", venueId).maybeSingle();
  if (isMissingTable(error)) return { pricing: NO_PRICING, ready: false };
  if (error) throw error;
  return { pricing: data ? fromRow(data) : NO_PRICING, ready: true };
}

/** Pricing rules for several venues (venues without a row are absent). Empty before the migration. */
export async function pricingForVenues(venueIds: string[]): Promise<Map<string, VenuePricing>> {
  if (venueIds.length === 0) return new Map();
  const { data, error } = await createAdminClient().from("venue_pricing_rules").select("*").in("venue_id", venueIds);
  if (isMissingTable(error)) return new Map();
  if (error) throw error;
  return new Map(data.map((r) => [r.venue_id, fromRow(r)]));
}

/** Deposit rate (fraction) per venue, the platform default for venues without their own. Never throws: deposits fall back to the default. */
export async function depositRatesForVenues(venueIds: string[]): Promise<(venueId: string) => number> {
  const pricing = await pricingForVenues([...new Set(venueIds)]).catch((err) => {
    console.error("pricing: could not read venue deposits; showing the platform default", err);
    return new Map<string, VenuePricing>();
  });
  return (venueId) => depositRateFor(pricing.get(venueId));
}

/** Changes some of a venue's pricing rules, keeping the rest. */
export async function saveVenuePricing(venueId: string, patch: Partial<VenuePricing>, updatedBy: string | null): Promise<VenuePricing> {
  const { pricing: current, ready } = await getVenuePricing(venueId);
  if (!ready) throw new PricingError(PRICING_UNAVAILABLE);
  const next = { ...current, ...patch };
  const { data, error } = await createAdminClient()
    .from("venue_pricing_rules")
    .upsert(
      {
        venue_id: venueId,
        deposit_pct: next.depositPct,
        guest_tiers: next.tiers as unknown as Json,
        rate_multipliers: next.multipliers as unknown as Json,
        lock_min_spend: next.lockMinSpend,
        locked_package_ids: next.lockedPackageIds,
        updated_by: updatedBy,
      },
      { onConflict: "venue_id" }
    )
    .select("*")
    .single();
  if (isMissingTable(error)) throw new PricingError(PRICING_UNAVAILABLE);
  if (error) throw error;
  return fromRow(data);
}

/** Minimum spend (pre-GST total) and per-guest minimum on the venue. */
export async function saveMinimumSpend(venueId: string, terms: { minSpendInr: number; minPerHeadInr: number }) {
  const { error } = await createAdminClient()
    .from("venues")
    .update({ min_spend_inr: terms.minSpendInr, min_spend_per_head_inr: terms.minPerHeadInr })
    .eq("id", venueId);
  if (error) throw error;
}

export async function saveCancellationTerms(venueId: string, terms: CancellationTier[]) {
  const { error } = await createAdminClient()
    .from("venues")
    .update({ cancellation_terms: terms as unknown as Json })
    .eq("id", venueId);
  if (error) throw error;
}

export interface ManualPackageInput {
  packageId: string | null;
  name: string;
  perHeadInr: number;
  dietaryTags: string[];
  description: string | null;
  isActive: boolean;
}

/**
 * Creates or updates one of the venue's menu packages from the host's form.
 * Same schema and rules as the AI negotiator's upsertMenuPackage (price range,
 * the last active package stays active), minus the approval step: the host is
 * the one acting. Returns the package id.
 */
export async function saveMenuPackage(venueId: string, input: ManualPackageInput): Promise<string> {
  const parsed = upsertMenuPackageInput.safeParse({
    package_id: input.packageId,
    name: input.name,
    per_head_inr: input.perHeadInr,
    dietary_tags: input.dietaryTags,
    description: input.description,
    is_active: input.isActive,
    reason: "Edited by the host",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = { name: "Name", per_head_inr: "Per-head price", dietary_tags: "Dietary coverage", description: "Description" }[String(issue?.path[0])] ?? "Package";
    throw new PricingError(`${field}: ${issue?.message ?? "invalid"}.`);
  }
  const db = createAdminClient();
  const { data: existing, error: readError } = await db.from("venue_menu_packages").select("id, is_active").eq("venue_id", venueId);
  if (readError) throw readError;
  const decision = menuPackageRules(parsed.data, {
    activePackageIds: existing.filter((p) => p.is_active).map((p) => p.id),
    packageExists: parsed.data.package_id === null || existing.some((p) => p.id === parsed.data.package_id),
  });
  if (!decision.allowed) throw new PricingError(decision.message.replace("Call getVenueTerms for current package ids.", "Reload the page."));

  const { package_id, name, per_head_inr, dietary_tags, description, is_active } = parsed.data;
  const fields = { name, per_head_inr, dietary_tags, description, is_active };
  const query = package_id
    ? db.from("venue_menu_packages").update(fields).eq("id", package_id).eq("venue_id", venueId)
    : db.from("venue_menu_packages").insert({ ...fields, venue_id: venueId });
  const { data, error } = await query.select("id").single();
  if (error) throw error;
  return data.id;
}
