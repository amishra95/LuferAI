import type { NextRequest } from "next/server";

import { authorize, data, failed } from "@/lib/api/respond";
import { loadControlTower, parseTowerFilters } from "@/lib/control-tower/load";
import { towerCsv } from "@/lib/control-tower/summary";

/**
 * GET /api/control-tower — the Control Tower's requests and summary (what
 * /control-tower shows), with the same filters: company (admins), dept, type,
 * city, status, from, to. format=csv downloads every matching request.
 *
 * Clients get their own company; admins every company, or one with ?company=<id>.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize((m) => m.role === "ADMIN" || (m.role === "CLIENT" && !!m.companyId));
  if ("response" in auth) return auth.response;
  const { member } = auth;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = parseTowerFilters(params, member.role === "CLIENT" ? member.companyId : null);

  try {
    const { rows, summary } = await loadControlTower(filters);
    if (params.format === "csv") {
      return new Response(towerCsv(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="control-tower-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return data({ summary, requests: rows });
  } catch (err) {
    return failed("api/control-tower", err);
  }
}
