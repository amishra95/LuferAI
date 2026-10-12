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
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { isRateCardActive } from "@/lib/rates/apply-rate-card";
import { autoDecision, checkOffer } from "@/lib/rfp/guardrails";
import { getNegotiationRules, rulesForVenues } from "@/lib/rfp/rules-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { tracer } from "@/lib/tracer";
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
  // Hosts' guardrails: over-budget instant quotes may be countered or declined at once.
  const rules = await rulesForVenues(matched.map((v) => v.id));

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
  const outcomes: { venue: string; status: "quoted" | "no_fit" | "auto_counter" | "auto_decline"; perHeadInr?: number; standardPerHead?: number; floored?: boolean; overBudget?: boolean; reason?: string }[] = [];
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
    const auto = quote.status === "quoted" && quote.over_budget && rules.has(venue.id)
      ? autoDecision(rules.get(venue.id)!, { standardPerHead: quote.per_head_inr, partySize: req.party_size, budgetPerHead: req.budget_per_head_inr })
      : ({ action: "none" } as const);
    if (auto.action === "decline") {
      outcomes.push({ venue: venue.name, status: "auto_decline", reason: auto.note });
      return { rfp_id: rfp.id, venue_id: venue.id, source: "venue" as const, status: "declined" as const, notes: auto.note, responded_at: now };
    }
    if (quote.status === "quoted" && auto.action === "counter") {
      const list = roundInr(auto.perHead * req.party_size);
      outcomes.push({ venue: venue.name, status: "auto_counter", perHeadInr: auto.perHead, standardPerHead: quote.per_head_inr, reason: auto.note });
      return {
        rfp_id: rfp.id,
        venue_id: venue.id,
        source: "venue" as const,
        status: "countered" as const,
        menu_package_id: quote.menu_package_id,
        per_head_inr: auto.perHead,
        list_amount_inr: list,
        rate_card_id: null,
        taxable_amount_inr: list,
        notes: auto.note,
        responded_at: now,
      };
    }
    outcomes.push(
      quote.status === "quoted"
        ? { venue: venue.name, status: "quoted", perHeadInr: quote.per_head_inr, floored: quote.min_spend_applied, overBudget: quote.over_budget }
        : { venue: venue.name, status: "no_fit", reason: quote.reason }
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

  // What each venue answered, for the /agents trace feed (read off the active
  // rfp.broadcast span): instant quotes, no-fits, and the venue's own
  // auto-counter / auto-decline rules (lib/rfp/guardrails autoDecision).
  tracer.annotate({ rfp: rfp.id.slice(0, 8), partySize: req.party_size, budgetPerHead: req.budget_per_head_inr, outcomes });

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
    response_id: r.id,
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
  rfp: Pick<Rfp, "id" | "brief" | "party_size" | "event_date" | "budget_per_head_inr" | "dietary_tags" | "status" | "created_at" | "origin">;
  requirements: RfpRequirements | null;
  companyName: string;
}

/** Postgres "column does not exist": rfps.origin before migration 0025. */
export const isMissingColumn = (error: { code?: string } | null | undefined) => error?.code === "42703" || error?.code === "PGRST204";

/** Open RFPs sent to a venue, for the property portal inbox. */
export async function listVenueRfps(venueId: string): Promise<VenueRfpItem[]> {
  const query = (withOrigin: boolean) =>
    createAdminClient()
      .from("rfp_responses")
      .select(
        `*, rfp:rfps!inner(id, brief, party_size, event_date, budget_per_head_inr, dietary_tags, status, created_at,${withOrigin ? " origin," : ""} requirements, company:companies(legal_name))`
      )
      .eq("venue_id", venueId)
      .eq("rfp.status", "open")
      .order("created_at", { ascending: false })
      .limit(20);
  let { data, error } = await query(true);
  // Before migration 0025 there's no origin column: every RFP came from a client.
  if (isMissingColumn(error)) ({ data, error } = await query(false));
  if (error) throw error;

  type Row = RfpResponse & { rfp: Omit<VenueRfpItem["rfp"], "origin"> & { origin?: string; requirements: Json; company: { legal_name: string } } };
  return (data as unknown as Row[]).map(({ rfp: { requirements, company, origin, ...rfp }, ...response }) => {
    const parsed = RfpRequirements.safeParse(requirements);
    return { response, rfp: { ...rfp, origin: origin ?? "client" }, requirements: parsed.success ? parsed.data : null, companyName: company.legal_name };
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
    .select("id, venue_id, menu_package_id, rfp:rfps!inner(party_size, status)")
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
  let standardPerHead: number | null = null;
  // The discount is measured from the package being offered (or the one quoted).
  const packageId = input.menuPackageId ?? existing.menu_package_id;
  if (packageId) {
    const { data: pkg } = await db
      .from("venue_menu_packages")
      .select("id, per_head_inr")
      .eq("id", packageId)
      .eq("venue_id", input.venueId)
      .maybeSingle();
    if (!pkg && input.menuPackageId) throw new Error("Unknown menu package");
    standardPerHead = pkg ? Number(pkg.per_head_inr) : null;
  }
  const { rules } = await getNegotiationRules(input.venueId);
  const breach = checkOffer(rules, { perHead: input.perHeadInr, partySize: existing.rfp.party_size, standardPerHead });
  if (breach) throw new GuardrailError(breach);

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

/** An offer outside the venue's guardrails (lib/rfp/guardrails.ts); its message is for the host. */
export class GuardrailError extends Error {}

// ----------------------------------------------------------------------------
// Direct quotes: the venue opens the RFP for a client it already works with
// ----------------------------------------------------------------------------

/** Companies a venue may quote directly: ones that booked it or sent it an RFP. */
export async function quoteableCompanies(venueId: string): Promise<{ id: string; name: string }[]> {
  const db = createAdminClient();
  const [{ data: booked }, { data: asked }] = await Promise.all([
    db.from("bookings").select("company:companies(id, legal_name)").eq("venue_id", venueId),
    db.from("rfp_responses").select("rfp:rfps!inner(company:companies(id, legal_name))").eq("venue_id", venueId),
  ]);
  type C = { id: string; legal_name: string } | null;
  const all = [...(booked ?? []).map((b) => (b as unknown as { company: C }).company), ...(asked ?? []).map((r) => (r as unknown as { rfp: { company: C } }).rfp.company)];
  const byId = new Map(all.filter((c): c is NonNullable<C> => Boolean(c)).map((c) => [c.id, c.legal_name]));
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface DirectQuoteInput {
  venueId: string;
  companyId: string;
  createdBy: string | null;
  eventDate: string;
  partySize: number;
  perHeadInr: number;
  menuPackageId: string | null;
  notes: string | null;
  today: string;
}

/**
 * Sends a quote the client didn't ask for: an RFP for the company (origin
 * 'venue') with this venue's priced response. It shows in the client's RFP
 * comparisons, where they can book it at this price. Checked against the
 * venue's capacity, availability and guardrails first.
 */
export async function createDirectQuote(input: DirectQuoteInput): Promise<{ rfpId: string; responseId: string }> {
  const db = createAdminClient();
  if (!(await quoteableCompanies(input.venueId)).some((c) => c.id === input.companyId)) {
    throw new GuardrailError("You can quote companies that have booked you or sent you an RFP.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate) || input.eventDate <= input.today) throw new GuardrailError("Pick a future date.");
  if (!Number.isInteger(input.partySize) || input.partySize < 1) throw new GuardrailError("Enter a whole number of guests.");
  if (!(input.perHeadInr > 0)) throw new GuardrailError("Enter a per-head price.");

  const { data: venue } = await db.from("venues").select("id, name, city, neighborhood, capacity_max").eq("id", input.venueId).single();
  if (!venue) throw new Error("Unknown venue");
  if (input.partySize > venue.capacity_max) throw new GuardrailError(`${venue.name} seats up to ${venue.capacity_max}.`);
  const { available } = await checkHoldAvailability({ venue_id: input.venueId, from: input.eventDate, to: input.eventDate });
  if (!available) throw new GuardrailError(`${venue.name} isn't free on that date: it's held, booked or blocked.`);

  let standardPerHead: number | null = null;
  let packageName: string | null = null;
  if (input.menuPackageId) {
    const { data: pkg } = await db.from("venue_menu_packages").select("id, name, per_head_inr").eq("id", input.menuPackageId).eq("venue_id", input.venueId).maybeSingle();
    if (!pkg) throw new GuardrailError("Unknown menu package.");
    standardPerHead = Number(pkg.per_head_inr);
    packageName = pkg.name;
  }
  const { rules } = await getNegotiationRules(input.venueId);
  const breach = checkOffer(rules, { perHead: input.perHeadInr, partySize: input.partySize, standardPerHead });
  if (breach) throw new GuardrailError(breach);

  const requirements: RfpRequirements = {
    summary: `Direct quote from ${venue.name}${packageName ? `: ${packageName}` : ""}`,
    event_type: "Direct quote",
    event_date: input.eventDate,
    party_size: input.partySize,
    budget_per_head_inr: null,
    city: venue.city,
    neighborhoods: [venue.neighborhood],
    dietary: [],
    requires_private_dining: false,
    other_requirements: input.notes ? [input.notes] : [],
  };
  const { data: rfp, error } = await db
    .from("rfps")
    .insert({
      company_id: input.companyId,
      created_by: input.createdBy,
      brief: requirements.summary + (input.notes ? `. ${input.notes}` : ""),
      requirements: requirements as unknown as Json,
      event_date: input.eventDate,
      party_size: input.partySize,
      budget_per_head_inr: null,
      city: venue.city,
      dietary_tags: [],
      origin: "venue",
    })
    .select("id")
    .single();
  if (error) throw error;

  const list = roundInr(input.perHeadInr * input.partySize);
  const { data: response, error: responseError } = await db
    .from("rfp_responses")
    .insert({
      rfp_id: rfp.id,
      venue_id: input.venueId,
      source: "venue",
      status: "countered",
      menu_package_id: input.menuPackageId,
      per_head_inr: input.perHeadInr,
      list_amount_inr: list,
      taxable_amount_inr: list,
      rate_card_id: null,
      notes: input.notes,
      responded_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (responseError) {
    await db.from("rfps").delete().eq("id", rfp.id);
    throw responseError;
  }
  return { rfpId: rfp.id, responseId: response.id };
}

/** A direct quote a company may book: open, from a venue, addressed to that company. */
export async function getDirectQuote(responseId: string, companyId: string) {
  const { data, error } = await createAdminClient()
    .from("rfp_responses")
    .select("id, venue_id, per_head_inr, status, rfp:rfps!inner(id, company_id, origin, status, event_date, party_size, brief)")
    .eq("id", responseId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.rfp.company_id !== companyId || data.rfp.origin !== "venue") return null;
  return data;
}

/** Closes a direct quote once it became a booking. */
export async function markQuoteAwarded(rfpId: string, bookingId: string) {
  const { error } = await createAdminClient().from("rfps").update({ status: "awarded", booking_id: bookingId }).eq("id", rfpId).eq("status", "open");
  if (error) throw error;
}
