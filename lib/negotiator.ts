import "server-only";

import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { z } from "zod";

import { checkToolCall, menuPackageRules, minimumSpendRules } from "@/lib/guardrails/engine";
import { setMinimumSpendInput, upsertMenuPackageInput } from "@/lib/guardrails/schemas";
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
        "Current commercial terms for this venue: minimum spend, capacity, menu packages and open RFPs it has quoted on. Call before proposing changes.",
      inputSchema: z.object({}),
      execute: async () => {
        const [{ data: venue }, { data: packages }, { data: rfps }] = await Promise.all([
          db.from("venues").select("name, capacity_max, min_spend_inr, pdr_available").eq("id", venueId).single(),
          db.from("venue_menu_packages").select("id, name, per_head_inr, dietary_tags, description, is_active").eq("venue_id", venueId).order("per_head_inr"),
          db
            .from("rfp_responses")
            .select("status, per_head_inr, list_amount_inr, notes, rfp:rfps!inner(party_size, event_date, budget_per_head_inr, dietary_tags, status)")
            .eq("venue_id", venueId)
            .eq("rfp.status", "open")
            .limit(10),
        ]);
        return { venue, packages: packages ?? [], openRfps: rfps ?? [] };
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
            const { data, error } = await db.from("venues").select("min_spend_inr").eq("id", venueId).single();
            if (error) throw new Error(error.message);
            return minimumSpendRules(a, { current: Number(data.min_spend_inr) });
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
            const { data, error } = await db.from("venue_menu_packages").select("id, is_active").eq("venue_id", venueId);
            if (error) throw new Error(error.message);
            return menuPackageRules(a, {
              activePackageIds: data.filter((p) => p.is_active).map((p) => p.id),
              packageExists: a.package_id === null || data.some((p) => p.id === a.package_id),
            });
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
