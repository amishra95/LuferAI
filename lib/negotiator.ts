import "server-only";

import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { z } from "zod";

import { checkToolCall, menuPackageRules, minimumSpendRules } from "@/lib/guardrails/engine";
import { effectiveRules, engineLimits } from "@/lib/guardrails/platform";
import { getPlatformGuardrails } from "@/lib/guardrails/platform-store";
import { setMinimumSpendInput, upsertMenuPackageInput } from "@/lib/guardrails/schemas";
import { describeMultiplier } from "@/lib/rates/venue-pricing";
import { getNegotiationRules } from "@/lib/rfp/rules-store";
import { getVenuePricing } from "@/lib/venues/pricing-store";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Tools for the property AI negotiator, bound to one venue. Writes go through the
 * signed-in user's Supabase client, so RLS ("property updates own venue",
 * "property manages own menu packages") is enforced on top of the venue scoping.
 * Mutating tools require the host's explicit approval (see the route's toolApproval),
 * then pass the guardrails in lib/guardrails before writing.
 */
export function negotiatorTools(db: ServerClient, venueId: string) {
  return {
    getVenueTerms: tool({
      description:
        "Current commercial terms for this venue: minimum spend, capacity, menu packages, open RFPs it has quoted on, the host's guardrails (minimum spend floor, maximum discount) and the host's own pricing (guest-count tiers, rate calendar, deposit, and the terms locked against AI changes). Proposals must respect all of them. Call before proposing changes.",
      inputSchema: z.object({}),
      execute: async () => {
        const [{ data: venue }, { data: packages }, { data: rfps }] = await Promise.all([
          db.from("venues").select("name, capacity_max, min_spend_inr, min_spend_per_head_inr, pdr_available, cancellation_terms").eq("id", venueId).single(),
          db.from("venue_menu_packages").select("id, name, per_head_inr, dietary_tags, description, is_active").eq("venue_id", venueId).order("per_head_inr"),
          db
            .from("rfp_responses")
            .select("status, per_head_inr, list_amount_inr, notes, rfp:rfps!inner(party_size, event_date, budget_per_head_inr, dietary_tags, status)")
            .eq("venue_id", venueId)
            .eq("rfp.status", "open")
            .limit(10),
        ]);
        const [{ rules }, { pricing }, { settings: platform }] = await Promise.all([getNegotiationRules(venueId), getVenuePricing(venueId), getPlatformGuardrails()]);
        const locked = new Set(pricing.lockedPackageIds);
        return {
          venue,
          packages: (packages ?? []).map((p) => ({ ...p, lockedByHost: locked.has(p.id) })),
          openRfps: rfps ?? [],
          // The host's rules within the platform's ceilings (what offers are actually checked against).
          hostGuardrails: effectiveRules(rules, platform),
          proposalLimits: {
            minimumSpendMaxChangePct: platform.minSpendMaxChangePct,
            packagePerHeadRangeInr: [platform.packageMinPerHeadInr, platform.packageMaxPerHeadInr],
          },
          // Set by hand on /property → Pricing. Quotes apply tiers and the calendar on top of package prices automatically.
          hostPricing: {
            minimumSpendLockedByHost: pricing.lockMinSpend,
            guestTiers: pricing.tiers,
            rateCalendar: pricing.multipliers.map((m) => ({ label: m.label, applies: describeMultiplier(m) })),
            depositPct: pricing.depositPct,
          },
        };
      },
    }),

    setMinimumSpend: tool({
      description: "Change the venue's minimum spend (pre-GST INR) applied to every new quote.",
      inputSchema: setMinimumSpendInput,
      execute: async (input) => {
        // Runs after the host approved; the guardrail still bounds how far one change can move it.
        const check = await checkToolCall(
          "setMinimumSpend",
          input,
          async (a) => {
            const [{ data, error }, { rules }, { pricing }, { settings: platform }] = await Promise.all([
              db.from("venues").select("min_spend_inr").eq("id", venueId).single(),
              getNegotiationRules(venueId),
              getVenuePricing(venueId),
              getPlatformGuardrails(),
            ]);
            if (error) throw new Error(error.message);
            return minimumSpendRules(a, { current: Number(data.min_spend_inr), floor: rules.minSpendFloor, locked: pricing.lockMinSpend }, engineLimits(platform).minimumSpend);
          },
          { venueId }
        );
        if (!check.ok) return { ok: false, refused: check.code, message: check.message };
        const { data, error } = await db
          .from("venues")
          .update({ min_spend_inr: check.args.min_spend_inr })
          .eq("id", venueId)
          .select("min_spend_inr")
          .single();
        if (error) throw new Error(error.message);
        return { ok: true, min_spend_inr: Number(data.min_spend_inr) };
      },
    }),

    upsertMenuPackage: tool({
      description:
        "Create or update a menu package (per-head price and the dietary needs it fully covers). Pass package_id to update an existing one.",
      inputSchema: upsertMenuPackageInput,
      execute: async (input) => {
        const check = await checkToolCall(
          "upsertMenuPackage",
          input,
          async (a) => {
            const [{ data, error }, { pricing }, { settings: platform }] = await Promise.all([
              db.from("venue_menu_packages").select("id, is_active").eq("venue_id", venueId),
              getVenuePricing(venueId),
              getPlatformGuardrails(),
            ]);
            if (error) throw new Error(error.message);
            return menuPackageRules(
              a,
              {
                activePackageIds: data.filter((p) => p.is_active).map((p) => p.id),
                packageExists: a.package_id === null || data.some((p) => p.id === a.package_id),
                lockedPackageIds: pricing.lockedPackageIds,
              },
              engineLimits(platform).menuPackage
            );
          },
          { venueId }
        );
        if (!check.ok) return { ok: false, refused: check.code, message: check.message };
        const { package_id, name, per_head_inr, dietary_tags, description, is_active } = check.args;
        const fields = { name, per_head_inr, dietary_tags, description, is_active };
        const query = package_id
          ? db.from("venue_menu_packages").update(fields).eq("id", package_id).eq("venue_id", venueId)
          : db.from("venue_menu_packages").insert({ ...fields, venue_id: venueId });
        const { data, error } = await query.select("id, name, per_head_inr, dietary_tags, is_active").single();
        if (error) throw new Error(error.message);
        return { ok: true, package: { ...data, per_head_inr: Number(data.per_head_inr) } };
      },
    }),
  };
}

export type NegotiatorUIMessage = UIMessage<never, UIDataTypes, InferUITools<ReturnType<typeof negotiatorTools>>>;
