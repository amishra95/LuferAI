/**
 * The booking agent's decisions, free of I/O so they can be tested
 * (tests/corporate-venue-os.test.mjs). lib/bookings/booking-agent.ts runs them
 * against live data: availability, the company's rate card and policy.
 *
 *   1. shortlist  venues that can host the event (capacity, alcohol, entertainment)
 *   2. negotiate  the lowest per-head that meets the venue's minimums after the
 *                 company's negotiated rate, never above the requester's ceiling
 *   3. route      confirm, send to the venue, or send for sign-off
 */

export interface AgentRequest {
  /** A specific venue, or null to let the agent pick. */
  venueId: string | null;
  eventDate: string;
  partySize: number;
  /** What the requester wants to pay per head (pre-GST, list price). */
  perHead: number;
  /** The most they'll pay per head; the agent may raise the offer up to here to meet a minimum. */
  maxPerHead: number;
  alcoholIncluded: boolean;
  entertainment: string[];
  privateDining: boolean;
}

export interface AgentVenue {
  id: string;
  name: string;
  capacity_max: number;
  min_spend_inr: number;
  min_spend_per_head_inr: number;
  pdr_available: boolean;
  serves_alcohol: boolean;
  entertainment: readonly string[];
}

/** The company's terms at a venue (corporate_rate_cards), if any. */
export interface AgentRate {
  discountPct: number;
  customPerHead: number | null;
  minimumSpendOverride: number | null;
}

export type Shortlisted<V> = { venue: V; rate: AgentRate | null; why: string[] };
export type Excluded<V> = { venue: V; reason: string };

/** Venues that can host the request, best first: negotiated terms, then the smallest room that fits. */
export function shortlistVenues<V extends AgentVenue>(venues: V[], req: AgentRequest, rates: ReadonlyMap<string, AgentRate>): { shortlist: Shortlisted<V>[]; excluded: Excluded<V>[] } {
  const shortlist: Shortlisted<V>[] = [];
  const excluded: Excluded<V>[] = [];
  for (const venue of venues) {
    if (req.venueId && venue.id !== req.venueId) continue;
    const missing = req.entertainment.filter((e) => !venue.entertainment.includes(e));
    const reason =
      venue.capacity_max < req.partySize
        ? `seats up to ${venue.capacity_max}`
        : req.alcoholIncluded && !venue.serves_alcohol
          ? "doesn't serve alcohol"
          : req.privateDining && !venue.pdr_available
            ? "has no private dining room"
            : missing.length
              ? `doesn't offer ${missing.join(", ").replace(/_/g, " ")}`
              : null;
    if (reason) {
      excluded.push({ venue, reason });
      continue;
    }
    const rate = rates.get(venue.id) ?? null;
    const why = [`seats ${venue.capacity_max}`];
    if (rate?.customPerHead != null) why.push(`company rate ${inr(rate.customPerHead)}/head`);
    else if (rate && rate.discountPct > 0) why.push(`${rate.discountPct}% company discount`);
    shortlist.push({ venue, rate, why });
  }
  shortlist.sort(
    (a, b) =>
      Number(b.rate !== null) - Number(a.rate !== null) ||
      (b.rate?.discountPct ?? 0) - (a.rate?.discountPct ?? 0) ||
      a.venue.capacity_max - b.venue.capacity_max ||
      a.venue.min_spend_inr - b.venue.min_spend_inr
  );
  return { shortlist, excluded };
}

const paise = (n: number) => Math.round(n * 100) / 100;
/** ₹1,875.28 — Indian grouping, paise only when there are any. */
export const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export type Negotiation =
  | { ok: true; listPerHead: number; negotiatedPerHead: number; total: number; raised: boolean; note: string }
  | { ok: false; requiredPerHead: number; note: string };

/**
 * The per-head offer: the requested amount, raised (up to the ceiling) only as
 * far as the venue's minimums need after the company's rate. Mirrors
 * applyRateCard: a custom rate replaces the price; otherwise the discount comes
 * off the list per-head.
 */
export function negotiatePerHead(
  req: Pick<AgentRequest, "partySize" | "perHead" | "maxPerHead">,
  venue: Pick<AgentVenue, "name" | "min_spend_inr" | "min_spend_per_head_inr">,
  rate: AgentRate | null
): Negotiation {
  const minimumSpend = rate?.minimumSpendOverride ?? venue.min_spend_inr;
  // What the company must pay per head (after its rate) to meet both minimums.
  const neededNet = paise(Math.max(minimumSpend / req.partySize, venue.min_spend_per_head_inr));

  if (rate?.customPerHead != null) {
    const net = rate.customPerHead;
    if (net < neededNet) return { ok: false, requiredPerHead: neededNet, note: `the company rate ${inr(net)}/head is below ${venue.name}'s ${inr(neededNet)}/head minimum` };
    return { ok: true, listPerHead: req.perHead, negotiatedPerHead: net, total: paise(net * req.partySize), raised: false, note: `company rate ${inr(net)}/head` };
  }

  const factor = 1 - (rate?.discountPct ?? 0) / 100;
  const net = (list: number) => paise(list * factor);
  if (net(req.perHead) >= neededNet) {
    const n = net(req.perHead);
    return { ok: true, listPerHead: req.perHead, negotiatedPerHead: n, total: paise(n * req.partySize), raised: false, note: rate?.discountPct ? `${rate.discountPct}% company discount applied` : "list price" };
  }
  // Raise the list offer just enough, to the rupee.
  const listNeeded = Math.ceil(neededNet / factor);
  if (listNeeded > req.maxPerHead) {
    return { ok: false, requiredPerHead: listNeeded, note: `${venue.name} needs ${inr(listNeeded)}/head to meet its minimum, above the ${inr(req.maxPerHead)} ceiling` };
  }
  const n = net(listNeeded);
  return {
    ok: true,
    listPerHead: listNeeded,
    negotiatedPerHead: n,
    total: paise(n * req.partySize),
    raised: true,
    note: `raised to ${inr(listNeeded)}/head to meet ${venue.name}'s minimum${rate?.discountPct ? `, ${rate.discountPct}% company discount applied` : ""}`,
  };
}

export type Routing = "confirm" | "venue" | "approval";

/**
 * Whether the agent may confirm on its own. Only an in-policy booking at a
 * Lufer.ai venue where the company has negotiated terms: the venue agreed those
 * corporate terms in advance. Anything needing sign-off goes to the approval
 * chain; everything else is sent to the venue to accept.
 */
export function routeBooking(opts: { requiresApproval: boolean; internalVenue: boolean; hasRateCard: boolean }): Routing {
  if (opts.requiresApproval) return "approval";
  return opts.internalVenue && opts.hasRateCard ? "confirm" : "venue";
}
