import type { NextRequest } from "next/server";

import { authorize, data, failed, json } from "@/lib/api/respond";
import { computeItcSummary, computeMonthlyPayouts, computePlatformMetrics, listBookings, type BookingDetail } from "@/lib/data";
import type { BookingStatus } from "@/lib/supabase/database.types";

const STATUSES: BookingStatus[] = ["PENDING_APPROVAL", "PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"];

/** Clients don't see the platform's commission or the venue's payout (as in booking_tax_breakdown). */
function forClient(b: BookingDetail) {
  const out: Partial<BookingDetail> = { ...b, venue: { ...b.venue } };
  delete out.commission_inr;
  delete out.venue_payout_inr;
  delete out.commission_rate;
  delete (out.venue as Partial<BookingDetail["venue"]>).commission_rate;
  return out;
}

/**
 * GET /api/bookings — bookings with GST invoice breakdowns, newest event first, plus
 * the summary for the caller's portal: platform metrics (admin), ITC (client) or
 * monthly payouts (venue).
 *
 * Scope: admins see everything and may narrow with ?company=<id> or ?venue=<id>;
 * clients see their company's; venue users see their venue's (never bookings still
 * awaiting the client's internal approval). Optional ?status=<BookingStatus>.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize((m) => m.role === "ADMIN" || (m.role === "CLIENT" && !!m.companyId) || (m.role === "PROPERTY" && !!m.venueId));
  if ("response" in auth) return auth.response;
  const { member } = auth;
  const params = request.nextUrl.searchParams;

  const status = params.get("status");
  if (status && !STATUSES.includes(status as BookingStatus)) return json({ error: `status must be one of ${STATUSES.join(", ")}` }, 400);

  const filter =
    member.role === "CLIENT"
      ? { companyId: member.companyId! }
      : member.role === "PROPERTY"
        ? { venueId: member.venueId! }
        : { companyId: params.get("company") ?? undefined, venueId: params.get("venue") ?? undefined };

  try {
    const all = await listBookings(filter);
    const bookings = status ? all.filter((b) => b.status === status) : all;
    if (member.role === "CLIENT") return data({ bookings: bookings.map(forClient), summary: computeItcSummary(all) });
    if (member.role === "PROPERTY") return data({ bookings, summary: computeMonthlyPayouts(all) });
    return data({ bookings, summary: computePlatformMetrics(all) });
  } catch (err) {
    return failed("api/bookings", err);
  }
}
