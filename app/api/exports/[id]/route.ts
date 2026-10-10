import { getCurrentMember } from "@/lib/auth/session";
import { getExpenseExport } from "@/lib/data";

/** Downloads one export's receipt: the exact bytes sent, so its SHA-256 matches the audit log. */
export async function GET(_req: Request, ctx: RouteContext<"/api/exports/[id]">) {
  // Receipts are financial records: admins see all, client users only their own company's.
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "Sign in to download receipts." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const row = await getExpenseExport(id);
  if (!row || (member.role !== "ADMIN" && (member.role !== "CLIENT" || row.tenant_id !== member.companyId))) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return new Response(row.payload, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="receipt-${(row.booking_id ?? row.catalog_order_id ?? row.id).slice(0, 8)}.json"`,
      "X-Lufer-Payload-SHA256": row.payload_sha256,
      "X-Lufer-Export-Status": row.status,
      "Cache-Control": "no-store",
    },
  });
}
