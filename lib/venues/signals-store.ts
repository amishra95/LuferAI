import "server-only";

import { dataSource } from "@/lib/data";
import { readDb } from "@/lib/data/local-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { SIGNAL_WINDOW_DAYS, venueResponseMedians, type ResponseSample } from "@/lib/venues/signals";

/** Enough for any venue's last year; the median doesn't need every row. */
const MAX_SAMPLES = 5000;

/**
 * Median hours each venue takes to accept a request, across every company
 * (lib/venues/signals.ts), over the last year. Only the per-venue median
 * leaves this function, and only for venues with enough bookings. A request
 * reaches the venue when it's made, or once its last approval is given.
 * Never throws: a missing signal just isn't shown.
 */
export async function venueResponseHours(): Promise<Map<string, number>> {
  try {
    return venueResponseMedians(await responseSamples());
  } catch (err) {
    console.error("venues: response times unavailable", err);
    return new Map();
  }
}

async function responseSamples(): Promise<ResponseSample[]> {
  const since = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 86_400_000).toISOString();
  if (dataSource() !== "supabase") {
    const db = await readDb();
    const approvedAt = lastApprovals(db.approvals.filter((a) => a.booking_id && a.status === "APPROVED" && a.decided_at).map((a) => ({ booking_id: a.booking_id!, decided_at: a.decided_at! })));
    return db.bookings
      .filter((b) => b.venue_accepted_at && b.venue_accepted_at >= since)
      .map((b) => sample(b, approvedAt.get(b.id)));
  }

  const db = createAdminClient();
  const { data: bookings, error } = await db
    .from("bookings")
    .select("id, venue_id, created_at, venue_accepted_at")
    .not("venue_accepted_at", "is", null)
    .gte("venue_accepted_at", since)
    .order("venue_accepted_at", { ascending: false })
    .limit(MAX_SAMPLES);
  if (error) throw error;
  if (!bookings.length) return [];
  const { data: approvals, error: e2 } = await db
    .from("booking_approvals")
    .select("booking_id, decided_at")
    .in("booking_id", bookings.map((b) => b.id))
    .eq("status", "APPROVED")
    .not("decided_at", "is", null);
  if (e2) throw e2;
  const approvedAt = lastApprovals(approvals.map((a) => ({ booking_id: a.booking_id!, decided_at: a.decided_at! })));
  return bookings.map((b) => sample(b, approvedAt.get(b.id)));
}

/** The latest approval per booking: when sign-off finished and the request went to the venue. */
function lastApprovals(rows: { booking_id: string; decided_at: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.booking_id) || r.decided_at > out.get(r.booking_id)!) out.set(r.booking_id, r.decided_at);
  return out;
}

const sample = (b: { venue_id: string; created_at: string; venue_accepted_at: string | null }, approvedAt: string | undefined): ResponseSample => ({
  venue_id: b.venue_id,
  reached_venue_at: approvedAt && approvedAt > b.created_at ? approvedAt : b.created_at,
  venue_accepted_at: b.venue_accepted_at!,
});
