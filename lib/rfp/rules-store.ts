import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { NO_RULES, type NegotiationRules } from "./guardrails";

/**
 * venue_negotiation_rules (migration 0025). Before the migration is applied
 * every venue reads as having no rules and saving explains why it can't.
 */

const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export const RULES_UNAVAILABLE = "Guardrails need database migration 0025 (venue_negotiation_rules). Ask an admin to apply it.";

type Row = { venue_id: string; min_spend_floor_inr: number | null; max_discount_pct: number | null; auto_counter: boolean; auto_decline_below_floor: boolean };

const fromRow = (r: Row): NegotiationRules => ({
  minSpendFloor: r.min_spend_floor_inr === null ? null : Number(r.min_spend_floor_inr),
  maxDiscountPct: r.max_discount_pct === null ? null : Number(r.max_discount_pct),
  autoCounter: r.auto_counter,
  autoDeclineBelowFloor: r.auto_decline_below_floor,
});

/** A venue's rules, and whether they can be stored here at all. */
export async function getNegotiationRules(venueId: string): Promise<{ rules: NegotiationRules; ready: boolean }> {
  const { data, error } = await createAdminClient().from("venue_negotiation_rules").select("*").eq("venue_id", venueId).maybeSingle();
  if (isMissingTable(error)) return { rules: NO_RULES, ready: false };
  if (error) throw error;
  return { rules: data ? fromRow(data) : NO_RULES, ready: true };
}

/** Rules for several venues at once (venues without a row are absent). Empty before the migration. */
export async function rulesForVenues(venueIds: string[]): Promise<Map<string, NegotiationRules>> {
  if (venueIds.length === 0) return new Map();
  const { data, error } = await createAdminClient().from("venue_negotiation_rules").select("*").in("venue_id", venueIds);
  if (isMissingTable(error)) return new Map();
  if (error) throw error;
  return new Map(data.map((r) => [r.venue_id, fromRow(r)]));
}

export async function saveNegotiationRules(venueId: string, rules: NegotiationRules, updatedBy: string | null): Promise<NegotiationRules> {
  const { data, error } = await createAdminClient()
    .from("venue_negotiation_rules")
    .upsert(
      {
        venue_id: venueId,
        min_spend_floor_inr: rules.minSpendFloor,
        max_discount_pct: rules.maxDiscountPct,
        auto_counter: rules.autoCounter,
        auto_decline_below_floor: rules.autoDeclineBelowFloor,
        updated_by: updatedBy,
      },
      { onConflict: "venue_id" }
    )
    .select("*")
    .single();
  if (isMissingTable(error)) throw new Error(RULES_UNAVAILABLE);
  if (error) throw error;
  return fromRow(data);
}
