import { getCurrentMember } from "@/lib/auth/session";
import { gstr8Summary, platformGstin } from "@/lib/marketplace/service";
import { returnPeriod } from "@/lib/marketplace/settlement";

/**
 * GET /api/admin/tcs?period=YYYY-MM → the period's Section 52 TCS as CSV, one
 * row per supplier GSTIN × place of supply, in GSTR-8 table 3 terms (gross
 * supplies, supplies returned, net value, IGST / CGST / SGST collected).
 * Platform admins only. Defaults to the current month (IST).
 */
export async function GET(req: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (member.role !== "ADMIN") return Response.json({ error: "forbidden" }, { status: 403 });
  const period = new URL(req.url).searchParams.get("period") ?? returnPeriod(new Date());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return Response.json({ error: "period must be YYYY-MM" }, { status: 400 });

  const rows = await gstr8Summary(period);
  const money = (n: number | null) => Number(n ?? 0).toFixed(2);
  const lines = [
    ["operator_gstin", "return_period", "supplier_gstin", "place_of_supply", "gross_supplies_inr", "supplies_returned_inr", "net_taxable_inr", "igst_inr", "cgst_inr", "sgst_inr"].join(","),
    ...rows.map((r) =>
      [platformGstin() ?? "", period, r.supplier_gstin ?? "", r.place_of_supply ?? "", money(r.gross_supplies_inr), money(r.supplies_returned_inr), money(r.net_taxable_inr), money(r.igst_inr), money(r.cgst_inr), money(r.sgst_inr)].join(",")
    ),
  ];
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gstr8-tcs-${period}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
