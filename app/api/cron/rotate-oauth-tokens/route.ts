import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/api/cron";
import { rotateExpiringTokens } from "@/lib/auth/token-rotator";

/**
 * Daily at 01:00 UTC (vercel.json → crons). Refreshes vault OAuth tokens (Zoho
 * Expense, ERPNext) that expire within 10 minutes (lib/auth/token-rotator.ts).
 * Exports also refresh on use, so a missed run doesn't break them.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. The
 * response lists each provider's outcome, never a token.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const results = await rotateExpiringTokens();
  const failed = results.some((r) => r.status === "failed");
  return NextResponse.json({ ok: !failed, results, ranAt: new Date().toISOString() }, { status: failed ? 502 : 200 });
}
