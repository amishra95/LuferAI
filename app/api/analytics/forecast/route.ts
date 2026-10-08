import type { NextRequest } from "next/server";

import { authorize, data, failed, json } from "@/lib/api/respond";
import { analyticsScopeFor, runBudgetForecast } from "@/lib/analytics/service";

const positive = (v: string | null) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * GET /api/analytics/forecast — projected spend against budget (the chat's
 * forecastBudget tool). Optional: ?horizonMonths=1–24, department, costCenter,
 * budgetInr, company (admins only).
 */
export async function GET(request: NextRequest) {
  const auth = await authorize((m) => m.role === "ADMIN" || (m.role === "CLIENT" && !!m.companyId));
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;

  const horizon = positive(params.get("horizonMonths"));
  if (horizon !== null && (!Number.isInteger(horizon) || horizon > 24)) return json({ error: "horizonMonths must be a whole number from 1 to 24" }, 400);

  try {
    const scope = await analyticsScopeFor(auth.member);
    if (!scope) return json({ error: "forbidden" }, 403);
    const result = await runBudgetForecast(scope, {
      horizonMonths: horizon,
      department: params.get("department"),
      costCenter: params.get("costCenter"),
      budgetInr: positive(params.get("budgetInr")),
      company: params.get("company"),
    });
    if ("error" in result) return json(result, 404);
    return data({ forecast: result });
  } catch (err) {
    return failed("api/analytics/forecast", err);
  }
}
