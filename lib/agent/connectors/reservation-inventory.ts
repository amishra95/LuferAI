import "server-only";

import { z } from "zod";

import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";

/**
 * Reservation availability across both directory tiers:
 * - internal venues (uuid ids): holds, confirmed bookings and host-blocked dates
 *   (lib/inventory/checkHoldAvailability.ts);
 * - partner venues ("network:ref" ids, lib/venues/partner-network.ts): the
 *   supplier's availability API at PARTNER_INVENTORY_URL, if one is configured.
 *
 * The partner API is called as GET {url}?ref=…&from=…&to=…&party_size=… and must
 * return JSON matching partnerInventorySchema.
 */
export const partnerInventorySchema = z.array(
  z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    available: z.boolean(),
    slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(48).default([]),
  })
);

export type InventoryDay = { date: string; available: boolean; reason: "hold" | "booked" | "blocked" | null; slots: string[] };

export type InventoryResult =
  | { status: "ok"; source: "internal" | "partner"; days: InventoryDay[] }
  | { status: "unsupported" | "unavailable"; source: "partner"; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function datesBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  return days;
}

async function internalInventory(venueId: string, from: string, to: string): Promise<InventoryResult> {
  const { locks } = await checkHoldAvailability({ venue_id: venueId, from, to });
  // Only the kind of lock leaves here: whose booking or hold it is isn't the caller's business.
  const REASON = { HOLD: "hold", BOOKING: "booked", BLOCKED: "blocked" } as const;
  const byDate = new Map(locks.map((l) => [l.date, REASON[l.kind]]));
  return {
    status: "ok",
    source: "internal",
    days: datesBetween(from, to).map((date) => ({ date, available: !byDate.has(date), reason: byDate.get(date) ?? null, slots: [] })),
  };
}

async function partnerInventory(venueId: string, from: string, to: string, partySize: number): Promise<InventoryResult> {
  const url = (process.env.PARTNER_INVENTORY_URL ?? "").trim();
  if (!url) return { status: "unsupported", source: "partner", message: "This partner venue's live availability isn't connected; request a quote through its supplier." };
  const ref = venueId.slice(venueId.indexOf(":") + 1);
  try {
    const res = await fetch(`${url}?${new URLSearchParams({ ref, from, to, party_size: String(partySize) })}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`returned ${res.status}`);
    const parsed = partnerInventorySchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("response didn't match the expected schema");
    return { status: "ok", source: "partner", days: parsed.data.map((d) => ({ date: d.date, available: d.available, reason: null, slots: d.slots })) };
  } catch (err) {
    return { status: "unavailable", source: "partner", message: `Partner inventory API: ${err instanceof Error ? err.message : "unavailable"}` };
  }
}

/** Day-by-day availability for one venue from `from` to `to` (at most 31 days). */
export function queryInventory(input: { venueId: string; from: string; to: string; partySize: number }): Promise<InventoryResult> {
  return UUID.test(input.venueId) ? internalInventory(input.venueId, input.from, input.to) : partnerInventory(input.venueId, input.from, input.to, input.partySize);
}
