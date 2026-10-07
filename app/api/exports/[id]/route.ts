import { getExpenseExport } from "@/lib/data";

/** Downloads one export's receipt: the exact bytes sent, so its SHA-256 matches the audit log. */
export async function GET(_req: Request, ctx: RouteContext<"/api/exports/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const row = await getExpenseExport(id);
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(row.payload, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="receipt-${row.booking_id.slice(0, 8)}.json"`,
      "X-Lufer-Payload-SHA256": row.payload_sha256,
      "X-Lufer-Export-Status": row.status,
      "Cache-Control": "no-store",
    },
  });
}
