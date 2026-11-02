import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/api/cron";
import { listCompanies } from "@/lib/data";
import { previousMonth } from "@/lib/finance/monthly-statement";
import { loadMonthlyStatement } from "@/lib/finance/statements";
import { todayInIndia } from "@/lib/gst-engine";
import { notifyMonthlyStatement } from "@/lib/services/notifications";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

/**
 * On the 1st of each month at 09:00 IST (vercel.json → crons), emails every
 * company with bookings last month its monthly statement. Companies with no
 * bookings that month get nothing. Re-running sends again (the email only
 * links to the statement, which is computed live, so a resend is harmless).
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "supabase_unconfigured" }, { status: 503 });

  const month = request.nextUrl.searchParams.get("month") ?? previousMonth(todayInIndia());
  const results = { month, sent: 0, skipped: 0, failed: 0, empty: 0 };
  try {
    for (const company of await listCompanies()) {
      const s = await loadMonthlyStatement(company.id, month);
      if (!s || s.bookingCount === 0) {
        results.empty++;
        continue;
      }
      const outcome = await notifyMonthlyStatement({
        number: s.number,
        label: s.label,
        month,
        companyId: company.id,
        bookingCount: s.bookingCount,
        vendorCount: s.vendors.length,
        total: s.totals.total,
        due: s.totals.due,
      });
      results[outcome.status]++;
    }
    return NextResponse.json({ ok: true, ...results, ranAt: new Date().toISOString() });
  } catch (error) {
    console.error("send-statements failed", error);
    return NextResponse.json({ error: "statements_failed", ...results }, { status: 500 });
  }
}
