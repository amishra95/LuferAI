import type { NextRequest } from "next/server";

import { authorize, data, failed, json } from "@/lib/api/respond";
import { isStatementMonth, renderStatementHtml, statementCsv } from "@/lib/finance/monthly-statement";
import { loadMonthlyStatement } from "@/lib/finance/statements";
import { DOCUMENT_POLICY } from "@/lib/security-headers";

/**
 * GET /api/finance/statements?month=YYYY-MM[&format=json|csv|html][&company=<id>]
 *
 * A company's monthly statement: every confirmed booking with an event in the
 * month, across all vendors, with one balance due. Clients get their own
 * company; admins pass ?company=.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize((m) => m.role === "ADMIN" || (m.role === "CLIENT" && !!m.companyId));
  if ("response" in auth) return auth.response;
  const { member } = auth;
  const params = request.nextUrl.searchParams;
  const month = params.get("month") ?? "";
  const format = params.get("format") ?? "json";
  if (!isStatementMonth(month)) return json({ error: "month must be YYYY-MM" }, 400);
  if (!["json", "csv", "html"].includes(format)) return json({ error: "format must be json, csv or html" }, 400);
  const companyId = member.role === "CLIENT" ? member.companyId! : params.get("company");
  if (!companyId) return json({ error: "company is required" }, 400);

  try {
    const statement = await loadMonthlyStatement(companyId, month);
    if (!statement) return json({ error: "Company not found" }, 404);
    const headers = { "Cache-Control": "private, no-store" };
    if (format === "csv") {
      return new Response(statementCsv(statement), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${statement.number}.csv"` },
      });
    }
    if (format === "html") {
      const { html, sha256 } = renderStatementHtml(statement);
      return new Response(html, {
        headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": DOCUMENT_POLICY, "X-Content-Sha256": sha256 },
      });
    }
    return data({ statement });
  } catch (err) {
    return failed("api/finance/statements", err);
  }
}
