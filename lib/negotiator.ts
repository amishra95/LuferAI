import "server-only";

import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { z } from "zod";

import { DIETARY_TAGS } from "@/lib/quotes";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Tools for the property AI negotiator, bound to one venue. Writes go through the
 * signed-in user's Supabase client, so RLS ("property updates own venue",
 * "property manages own menu packages") is enforced on top of the venue scoping.
 * Mutating tools require the host's explicit approval (see the route's toolApproval).
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
      inputSchema: z.object({
        min_spend_inr: z.number().min(0).max(10_000_000),
        reason: z.string().describe("Why this change, in one sentence, for the host to review"),
      }),
      execute: async ({ min_spend_inr }) => {
        const { data, error } = await db
          .from("venues")
          .update({ min_spend_inr })
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
      inputSchema: z.object({
        package_id: z.uuid().nullable().describe("Existing package id to update, or null to create"),
        name: z.string().min(1).max(80),
        per_head_inr: z.number().positive().max(100_000),
        dietary_tags: z.array(z.enum(DIETARY_TAGS)),
        description: z.string().max(280).nullable(),
        is_active: z.boolean(),
        reason: z.string().describe("Why this change, in one sentence, for the host to review"),
      }),
      execute: async ({ package_id, name, per_head_inr, dietary_tags, description, is_active }) => {
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
