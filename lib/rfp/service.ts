import "server-only";

import { z } from "zod";

import { roundInr } from "@/lib/gst-engine";
import {
  buildComparisonMatrix,
  DIETARY_TAGS,
  priceQuote,
  quoteVenue,
  sortMatrixColumns,
  type MatrixColumn,
} from "@/lib/quotes";
import { isRateCardActive } from "@/lib/rates/apply-rate-card";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Rfp, RfpResponse, Venue } from "@/lib/supabase/database.types";

/** Most venues a single brief is broadcast to. */
export const MAX_BROADCAST = 8;

/** What the model extracts from a free-text event brief (see app/api/ai/rfp-broadcast). */
export const RfpRequirements = z.object({
  summary: z.string().describe("One-line summary of the event for venue hosts"),
  event_type: z.string().describe("e.g. team dinner, offsite, client cocktail evening"),
  event_date: z.string().nullable().describe("ISO date YYYY-MM-DD, or null if not stated"),
  party_size: z.number().int().positive().describe("Number of guests"),
  budget_per_head_inr: z.number().positive().nullable().describe("Pre-GST budget per guest in INR, or null"),
  city: z.string().nullable().describe("City, or null if not stated"),
  neighborhoods: z.array(z.string()).describe("Preferred neighbourhoods; empty if none"),
  dietary: z.array(z.enum(DIETARY_TAGS)).describe("Dietary requirements the menu must cover for everyone"),
  requires_private_dining: z.boolean().describe("True if a private dining room / exclusive space is required"),
  other_requirements: z.array(z.string()).describe("AV, music, accessibility and other asks, verbatim-ish"),
});
export type RfpRequirements = z.infer<typeof RfpRequirements>;

const norm = (s: string) => s.trim().toLowerCase();

/** City match first, then preferred neighbourhoods, then roomiest — capped at MAX_BROADCAST. */
function matchVenues(venues: Venue[], req: RfpRequirements): Venue[] {
  const preferred = new Set(req.neighborhoods.map(norm));
  return venues
    .filter((v) => !req.city || norm(v.city) === norm(req.city))
    .sort(
      (a, b) =>
        Number(preferred.has(norm(b.neighborhood))) - Number(preferred.has(norm(a.neighborhood))) ||
        Number(b.capacity_max >= req.party_size) - Number(a.capacity_max >= req.party_size) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, MAX_BROADCAST);
}

export interface BroadcastResult {
  rfp: Rfp;
  columns: MatrixColumn[];
  markdown: string;
}

/** Creates the RFP and one instant-quoted response per matched venue. */
export async function broadcastRfp(input: {
  companyId: string;
  createdBy: string;
  brief: string;
  requirements: RfpRequirements;
  today: string;
}): Promise<BroadcastResult> {
  const db = createAdminClient();
  const { requirements: req } = input;

  const [{ data: company }, { data: venues }, { data: packages }, { data: cards }] = await Promise.all([
    db.from("companies").select("id, gstin").eq("id", input.companyId).single(),
    db.from("venues").select("*").eq("is_active", true),
    db.from("venue_menu_packages").select("*").eq("is_active", true),
    db.from("corporate_rate_cards").select("*").eq("tenant_id", input.companyId),
  ]);
  if (!company) throw new Error("Unknown company");

  const matched = matchVenues(venues ?? [], req);

  const { data: rfp, error } = await db
    .from("rfps")
    .insert({
      company_id: company.id,
      created_by: input.createdBy,
      brief: input.brief,
      requirements: req as unknown as Json,
      event_date: req.event_date,
      party_size: req.party_size,
      budget_per_head_inr: req.budget_per_head_inr,
      city: req.city,
      dietary_tags: req.dietary,
    })
    .select("*")
    .single();
  if (error) throw error;

  const now = new Date().toISOString();
  const rows = matched.map((venue) => {
    // The card in force on the event date (or today, when the brief has no date).
    const card = (cards ?? []).find((c) => c.venue_id === venue.id && isRateCardActive(c, req.event_date ?? input.today));
    const quote = quoteVenue(
      { ...venue, min_spend_inr: Number(venue.min_spend_inr) },
      (packages ?? []).filter((p) => p.venue_id === venue.id).map((p) => ({ ...p, per_head_inr: Number(p.per_head_inr) })),
      {
        partySize: req.party_size,
        budgetPerHead: req.budget_per_head_inr,
        dietary: req.dietary,
        requiresPdr: req.requires_private_dining,
        rateCard: card
          ? {
              ...card,
              discount_percentage: Number(card.discount_percentage),
              custom_per_head_rate: card.custom_per_head_rate != null ? Number(card.custom_per_head_rate) : null,
              minimum_spend_override: card.minimum_spend_override != null ? Number(card.minimum_spend_override) : null,
            }
          : null,
        companyGstin: company.gstin,
      }
    );
    return quote.status === "quoted"
      ? {
          rfp_id: rfp.id,
          venue_id: venue.id,
          status: "quoted" as const,
          menu_package_id: quote.menu_package_id,
          per_head_inr: quote.per_head_inr,
          list_amount_inr: quote.price.list_amount,
          rate_card_id: quote.rate_card_id,
          taxable_amount_inr: quote.price.taxable_value,
          notes: [quote.min_spend_applied && "Minimum spend applied", quote.over_budget && "Above per-head budget"]
            .filter(Boolean)
            .join(" · ") || null,
          responded_at: now,
        }
      : { rfp_id: rfp.id, venue_id: venue.id, status: "no_fit" as const, notes: quote.reason, responded_at: now };
  });

  if (rows.length > 0) {
    const { error: insertError } = await db.from("rfp_responses").insert(rows);
    if (insertError) throw insertError;
  }

  const [withMatrix] = await listRfps({ rfpIds: [rfp.id] });
  return withMatrix;
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

type ResponseRow = RfpResponse & {
  venue: Pick<Venue, "name" | "neighborhood" | "capacity_max" | "pdr_available" | "gstin">;
  menu_package: { name: string } | null;
};

function toColumn(r: ResponseRow, companyGstin: string): MatrixColumn {
  const priced = (r.status === "quoted" || r.status === "countered") && r.list_amount_inr != null;
  return {
    venue: r.venue,
    status: r.status,
    package_name: r.menu_package?.name ?? null,
    per_head_inr: r.per_head_inr != null ? Number(r.per_head_inr) : null,
    price: priced
      ? priceQuote({
          listAmount: Number(r.list_amount_inr),
          taxableValue: Number(r.taxable_amount_inr ?? r.list_amount_inr),
          companyGstin,
          venueGstin: r.venue.gstin,
        })
      : null,
    notes: r.notes,
  };
}

/** RFPs (newest first) with their comparison matrix, filtered by company or id. */
export async function listRfps(filter: { companyId?: string; rfpIds?: string[] }): Promise<BroadcastResult[]> {
  const db = createAdminClient();
  let query = db
    .from("rfps")
    .select(
      "*, company:companies(gstin), responses:rfp_responses(*, venue:venues(name, neighborhood, capacity_max, pdr_available, gstin), menu_package:venue_menu_packages(name))"
    )
    .order("created_at", { ascending: false })
    .limit(10);
  if (filter.companyId) query = query.eq("company_id", filter.companyId);
  if (filter.rfpIds) query = query.in("id", filter.rfpIds);

  const { data, error } = await query;
  if (error) throw error;

  type Row = Rfp & { company: { gstin: string }; responses: ResponseRow[] };
  return (data as unknown as Row[]).map(({ company, responses, ...rfp }) => {
    const columns = sortMatrixColumns(responses.map((r) => toColumn(r, company.gstin)));
    return {
      rfp,
      columns,
      markdown: buildComparisonMatrix(
        { ...rfp, budget_per_head_inr: rfp.budget_per_head_inr != null ? Number(rfp.budget_per_head_inr) : null },
        columns
      ),
    };
  });
}

export interface VenueRfpItem {
  response: RfpResponse;
  rfp: Pick<Rfp, "id" | "brief" | "party_size" | "event_date" | "budget_per_head_inr" | "dietary_tags" | "status" | "created_at">;
  requirements: RfpRequirements | null;
  companyName: string;
}

/** Open RFPs sent to a venue, for the property portal inbox. */
export async function listVenueRfps(venueId: string): Promise<VenueRfpItem[]> {
  const { data, error } = await createAdminClient()
    .from("rfp_responses")
    .select(
      "*, rfp:rfps!inner(id, brief, party_size, event_date, budget_per_head_inr, dietary_tags, status, created_at, requirements, company:companies(legal_name))"
    )
    .eq("venue_id", venueId)
    .eq("rfp.status", "open")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;

  type Row = RfpResponse & { rfp: VenueRfpItem["rfp"] & { requirements: Json; company: { legal_name: string } } };
  return (data as unknown as Row[]).map(({ rfp: { requirements, company, ...rfp }, ...response }) => {
    const parsed = RfpRequirements.safeParse(requirements);
    return { response, rfp, requirements: parsed.success ? parsed.data : null, companyName: company.legal_name };
  });
}

// ----------------------------------------------------------------------------
// Venue counter-offers
// ----------------------------------------------------------------------------

/**
 * A venue's reply to an RFP: a counter (per-head price, optional package) or a decline.
 * A counter is the venue's final price for this client, so no rate card is applied
 * on top (the venue sees who is asking and can honour negotiated terms itself).
 */
export async function respondToRfp(input: {
  responseId: string;
  venueId: string;
  decline: boolean;
  perHeadInr?: number;
  menuPackageId?: string | null;
  notes?: string | null;
}) {
  const db = createAdminClient();
  const { data: existing } = await db
    .from("rfp_responses")
    .select("id, venue_id, rfp:rfps!inner(party_size, status)")
    .eq("id", input.responseId)
    .eq("venue_id", input.venueId) // scoped: a venue can only answer its own RFPs
    .maybeSingle();
  if (!existing) throw new Error("RFP not found");
  if (existing.rfp.status !== "open") throw new Error("This RFP is closed");

  if (input.decline) {
    const { error } = await db
      .from("rfp_responses")
      .update({ source: "venue", status: "declined", notes: input.notes ?? null, responded_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  if (!input.perHeadInr || !(input.perHeadInr > 0)) throw new Error("Enter a per-head price");
  if (input.menuPackageId) {
    const { data: pkg } = await db
      .from("venue_menu_packages")
      .select("id")
      .eq("id", input.menuPackageId)
      .eq("venue_id", input.venueId)
      .maybeSingle();
    if (!pkg) throw new Error("Unknown menu package");
  }

  const list = roundInr(input.perHeadInr * existing.rfp.party_size);
  const { error } = await db
    .from("rfp_responses")
    .update({
      source: "venue",
      status: "countered",
      per_head_inr: input.perHeadInr,
      menu_package_id: input.menuPackageId ?? null,
      list_amount_inr: list,
      taxable_amount_inr: list,
      rate_card_id: null,
      notes: input.notes ?? null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) throw error;
}

/** A venue's menu packages (active first, cheapest first), for the counter-offer form. */
export async function listVenuePackages(venueId: string) {
  const { data, error } = await createAdminClient()
    .from("venue_menu_packages")
    .select("id, name, per_head_inr, dietary_tags, is_active")
    .eq("venue_id", venueId)
    .order("is_active", { ascending: false })
    .order("per_head_inr");
  if (error) throw error;
  return data.map((p) => ({ ...p, per_head_inr: Number(p.per_head_inr) }));
}
