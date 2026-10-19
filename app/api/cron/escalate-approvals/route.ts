import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/api/cron";
import { escalateOverdueApprovals } from "@/lib/services/enterprise/governanceStore";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

/**
 * Daily sweep at 09:00 IST (vercel.json → crons; daily so it fits Vercel Hobby —
 * switch to "0 * * * *" on Pro for hourly deadlines). Every approval step still
 * pending past its deadline (approval_policy_rules.sla_hours) is handed to the next
 * tier up the chain (escalate_overdue_approvals, migration 0030). Steps with nobody
 * above them stay put and are retried on the next run.
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

  let escalated: number;
  try {
    escalated = await escalateOverdueApprovals();
  } catch (error) {
    console.error("escalate-approvals failed", error);
    return NextResponse.json({ error: "escalation_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, escalated, ranAt: new Date().toISOString() });
}
