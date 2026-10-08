import type { NextRequest } from "next/server";

import { authorize, data, failed, json } from "@/lib/api/respond";
import { SPEND_GROUPS, SPEND_PERIODS, type SpendGroupBy, type SpendPeriod } from "@/lib/analytics/finance";
import { analyticsScopeFor, runSpendAnalysis } from "@/lib/analytics/service";

/**
 * GET /api/analytics — spend for a period, grouped (the chat's analyzeSpend tool).
 * ?period=fytd|last_fy|… (default fytd) &groupBy=month|venue|… (default month)
 * &company=<name> (admins only; clients are pinned to their company).
 */
export async function GET(request: NextRequest) {
  const auth = await authorize((m) => m.role === "ADMIN" || (m.role === "CLIENT" && !!m.companyId));
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;

  const period = (params.get("period") ?? "fytd") as SpendPeriod;
  const groupBy = (params.get("groupBy") ?? "month") as SpendGroupBy;
  if (!SPEND_PERIODS.includes(period)) return json({ error: `period must be one of ${SPEND_PERIODS.join(", ")}` }, 400);
  if (!SPEND_GROUPS.includes(groupBy)) return json({ error: `groupBy must be one of ${SPEND_GROUPS.join(", ")}` }, 400);

  try {
    const scope = await analyticsScopeFor(auth.member);
    if (!scope) return json({ error: "forbidden" }, 403);
    const result = await runSpendAnalysis(scope, { period, groupBy, company: params.get("company") });
    if ("error" in result) return json(result, 404);
    return data({ analysis: result });
  } catch (err) {
    return failed("api/analytics", err);
  }
}
