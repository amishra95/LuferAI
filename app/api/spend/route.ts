import type { NextRequest } from "next/server";

import { authorize, data, failed } from "@/lib/api/respond";
import { getSpendAnalytics } from "@/lib/data/analytics";

/**
 * GET /api/spend — financial-year spend analytics (what /admin charts): monthly and
 * cumulative pre-GST spend, rate-card savings, spend committed ahead, department
 * budget use and pending approvals.
 *
 * Admins get the platform, or one company with ?company=<id>; clients get their own company.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize((m) => m.role === "ADMIN" || (m.role === "CLIENT" && !!m.companyId));
  if ("response" in auth) return auth.response;
  const { member } = auth;
  const companyId = member.role === "CLIENT" ? member.companyId! : (request.nextUrl.searchParams.get("company") ?? undefined);

  try {
    return data({ spend: await getSpendAnalytics(undefined, { companyId }) });
  } catch (err) {
    return failed("api/spend", err);
  }
}
