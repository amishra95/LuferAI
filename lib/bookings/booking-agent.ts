import "server-only";

import { inr, negotiatePerHead, routeBooking, shortlistVenues, type AgentRate, type AgentRequest } from "@/lib/bookings/agent-plan";
import { confirmBooking } from "@/lib/bookings/confirm";
import { placeBookingRequest } from "@/lib/bookings/place-booking";
import type { ExpenseInput } from "@/lib/bookings/expense";
import { listRateCards, listVenues } from "@/lib/data";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { isRateCardActive } from "@/lib/rates/apply-rate-card";
import { clip, logAgentRun } from "@/lib/telemetry/runs";
import { tracer } from "@/lib/tracer";

/**
 * The booking agent: takes an event request and books it end to end through
 * the same path as a person would (placeBookingRequest: pricing, policy,
 * approvals, date hold), adding the steps a person does by hand:
 *
 *   shortlist  → venues that can host it (lib/bookings/agent-plan.ts)
 *   availability → the first shortlisted venue free on the date
 *   negotiate  → the per-head offer that meets the venue's minimums under the
 *                company's rate card, within the requester's ceiling
 *   place      → the booking request (policy decides whether sign-off is needed)
 *   route      → confirm (in policy, Lufer.ai venue, pre-agreed corporate terms),
 *                or leave it with the venue / the approval chain
 *
 * Deterministic: no model call, so it runs without an AI key and can't
 * hallucinate a venue or a price. Each step is a span (live in the inspector)
 * and the run is logged as `booking-agent`.
 */

export interface AgentStep {
  step: "shortlist" | "availability" | "negotiate" | "choose" | "place" | "confirm";
  ok: boolean;
  detail: string;
}

export type AgentBookingStatus = "confirmed" | "with_venue" | "with_supplier" | "awaiting_approval" | "failed";

export interface AgentBookingOutcome {
  status: AgentBookingStatus;
  message: string;
  steps: AgentStep[];
  bookingId?: string;
  venueId?: string;
  venueName?: string;
  /** Catalogue orders (lib/catalog/catalog-agent.ts). */
  orderId?: string;
  partnerId?: string;
  itemName?: string;
  perHead?: number;
  total?: number;
  /** The run's trace, for opening in the inspector. */
  traceId?: string;
}

export interface BookingAgentInput extends AgentRequest {
  companyId: string;
  userId: string;
  expense: ExpenseInput;
  notes?: string;
}

/** How many available venues the agent tries before giving up. */
const MAX_ATTEMPTS = 3;

export async function runBookingAgent(input: BookingAgentInput): Promise<AgentBookingOutcome> {
  const started = Date.now();
  const steps: AgentStep[] = [];
  const outcome = await tracer.trace(
    "agent.booking",
    async (root) => {
      root.setAttributes({ party_size: input.partySize, event_date: input.eventDate, venue: input.venueId ?? "any" });
      const result = await book(input, steps);
      root.setAttribute("status", result.status);
      return { ...result, traceId: root.traceId };
    },
    { root: true }
  );

  const venue = outcome.venueName ? ` at ${outcome.venueName}` : "";
  await logAgentRun("booking-agent", {
    at: new Date().toISOString(),
    ok: outcome.status !== "failed",
    durationMs: Date.now() - started,
    source: "api",
    task: clip(`Book ${input.partySize} guests on ${input.eventDate}${venue}: ${outcome.status.replace("_", " ")}`),
    steps: steps.length,
    ...(outcome.status === "failed" && { error: outcome.message }),
  });
  return outcome;
}

async function book(input: BookingAgentInput, steps: AgentStep[]): Promise<Omit<AgentBookingOutcome, "traceId">> {
  const fail = (message: string): Omit<AgentBookingOutcome, "traceId"> => ({ status: "failed", message, steps });

  // 1 · Shortlist ---------------------------------------------------------------------------
  const { shortlist, excluded } = await tracer.trace("agent.shortlist", async (span) => {
    const [venues, cards] = await Promise.all([listVenues(), listRateCards({ tenantId: input.companyId })]);
    const rates = new Map<string, AgentRate>(
      cards
        .filter((c) => isRateCardActive(c, input.eventDate))
        .map((c) => [c.venue_id, { discountPct: Number(c.discount_percentage), customPerHead: c.custom_per_head_rate, minimumSpendOverride: c.minimum_spend_override }])
    );
    const result = shortlistVenues(venues.map((v) => ({ ...v, min_spend_inr: Number(v.min_spend_inr), min_spend_per_head_inr: Number(v.min_spend_per_head_inr) })), input, rates);
    span.setAttributes({ shortlisted: result.shortlist.length, excluded: result.excluded.length });
    return result;
  });
  if (shortlist.length === 0) {
    const why = excluded.map((e) => `${e.venue.name} ${e.reason}`).join("; ");
    steps.push({ step: "shortlist", ok: false, detail: why || "No venue matched" });
    return fail(input.venueId ? `That venue can't host this event: ${why}.` : "No venue can host this event.");
  }
  steps.push({ step: "shortlist", ok: true, detail: shortlist.slice(0, 3).map((s) => `${s.venue.name} (${s.why.join(", ")})`).join("; ") });

  // 2–3 · Availability and negotiation, venue by venue -------------------------------------
  const notes: string[] = [];
  for (const candidate of shortlist.slice(0, input.venueId ? 1 : MAX_ATTEMPTS)) {
    const { venue, rate } = candidate;
    const available = await tracer.trace("agent.availability", async (span) => {
      span.setAttribute("venue", venue.name);
      return (await checkHoldAvailability({ venue_id: venue.id, from: input.eventDate, to: input.eventDate })).available;
    });
    if (!available) {
      notes.push(`${venue.name} is booked on ${input.eventDate}`);
      steps.push({ step: "availability", ok: false, detail: `${venue.name} isn't available on ${input.eventDate}` });
      continue;
    }
    steps.push({ step: "availability", ok: true, detail: `${venue.name} is free on ${input.eventDate}` });

    const deal = await tracer.trace("agent.negotiate", async (span) => {
      const d = negotiatePerHead(input, venue, rate);
      span.setAttributes({ venue: venue.name, ok: d.ok, ...(d.ok && { per_head: d.negotiatedPerHead }) });
      return d;
    });
    if (!deal.ok) {
      notes.push(deal.note);
      steps.push({ step: "negotiate", ok: false, detail: deal.note });
      continue;
    }
    steps.push({ step: "negotiate", ok: true, detail: `${inr(deal.negotiatedPerHead)}/head, ${inr(deal.total)} total: ${deal.note}` });

    // 4 · Place: the one booking path (pricing re-checked server-side, policy, approvals, hold).
    const placed = await tracer.trace("agent.place", () =>
      placeBookingRequest({
        companyId: input.companyId,
        userId: input.userId,
        venueId: venue.id,
        eventDate: input.eventDate,
        partySize: input.partySize,
        budgetPerHead: deal.listPerHead,
        notes: input.notes ?? "Booked by the booking agent",
        expense: input.expense,
        alcoholIncluded: input.alcoholIncluded,
        entertainment: input.entertainment,
      })
    );
    if (placed.status !== "success" || !placed.bookingId) {
      const detail = [placed.message, ...Object.values(placed.fieldErrors ?? {})].filter(Boolean).join(" ");
      steps.push({ step: "place", ok: false, detail });
      // A validation failure at one venue (policy block, missing approvers) won't change at the next.
      return fail(detail);
    }
    steps.push({ step: "place", ok: true, detail: placed.message });
    const base = { bookingId: placed.bookingId, venueId: venue.id, venueName: venue.name, perHead: deal.negotiatedPerHead, total: deal.total, steps };

    // 5 · Route --------------------------------------------------------------------------------
    const route = routeBooking({ requiresApproval: Boolean(placed.approval), internalVenue: true, hasRateCard: rate !== null });
    if (route === "approval") {
      return { ...base, status: "awaiting_approval", message: `Booked ${venue.name}; waiting for sign-off from ${placed.approval!.approverName} (${placed.approval!.reason}).` };
    }
    if (route === "venue") {
      return { ...base, status: "with_venue", message: placed.message };
    }
    await tracer.trace("agent.confirm", () => confirmBooking(placed.bookingId!, venue.id));
    steps.push({ step: "confirm", ok: true, detail: `Confirmed on ${venue.name}'s pre-agreed corporate terms` });
    return { ...base, status: "confirmed", message: `Confirmed ${venue.name} for ${input.partySize} guests on ${input.eventDate} at ${inr(deal.negotiatedPerHead)}/head.` };
  }
  return fail(notes.length ? `Couldn't book: ${notes.join("; ")}.` : "Couldn't book any shortlisted venue.");
}
