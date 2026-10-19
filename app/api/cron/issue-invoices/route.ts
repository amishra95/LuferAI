import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/api/cron";
import { runBillingSweep } from "@/lib/services/contracts/contractStore";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

/**
 * Daily at 06:00 IST (vercel.json → crons). Issues contract instalments whose
 * issue date has come (the balance, BALANCE_ISSUE_LEAD_DAYS before it falls
 * due), numbering them in the venue's FY series, and retries post-execution
 * steps (invoices, expense export, deposit capture) that didn't finish.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "supabase_unconfigured" }, { status: 503 });

  try {
    return NextResponse.json({ ok: true, ...(await runBillingSweep()), ranAt: new Date().toISOString() });
  } catch (error) {
    console.error("issue-invoices failed", error);
    return NextResponse.json({ error: "billing_failed" }, { status: 500 });
  }
}
