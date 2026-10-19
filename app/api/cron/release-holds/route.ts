import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/api/cron";
import { releaseExpiredHolds } from "@/lib/approvals/service";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

/**
 * Daily sweep at 02:00 IST (vercel.json → crons; daily so it fits Vercel Hobby —
 * switch to "0 * * * *" on Pro). An inventory hold stops locking its venue
 * date as soon as hold_expires_at passes (availability checks compare the time),
 * so nothing is double-booked between runs; this marks those holds RELEASED so
 * the hold lists and reports match. Converting/releasing on booking changes is
 * done by the bookings_sync_inventory_holds trigger.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "supabase_unconfigured" }, { status: 503 });
  }

  let releasedHolds: number;
  try {
    releasedHolds = await releaseExpiredHolds();
  } catch (error) {
    console.error("release-holds failed", error);
    return NextResponse.json({ error: "release_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    releasedHolds,
    ranAt: new Date().toISOString(),
  });
}
