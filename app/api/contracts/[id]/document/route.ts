import { getCurrentMember } from "@/lib/auth/session";
import { ContractError, getContractBundle } from "@/lib/services/contracts/contractStore";
import { exportWithCertificate } from "@/lib/services/contracts/render";
import { DOCUMENT_POLICY } from "@/lib/security-headers";

/**
 * GET /api/contracts/<id>/document: the contract as issued, with its signature
 * certificate appended, as a print-ready HTML page (use the browser's Save as
 * PDF). ?download=1 sends it as an attachment. Only the booking's company, its
 * venue and admins can open it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/contracts/[id]/document">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const bundle = await getContractBundle(id, member);
    if (!bundle) return Response.json({ error: "not_found" }, { status: 404 });
    const html = exportWithCertificate(bundle.contract, bundle.signatures);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        // The document is static HTML we generated; nothing in it should run or load.
        "Content-Security-Policy": DOCUMENT_POLICY,
        "X-Content-Type-Options": "nosniff",
        ...(download ? { "Content-Disposition": `attachment; filename="${bundle.terms.contractNumber}.html"` } : {}),
      },
    });
  } catch (err) {
    if (err instanceof ContractError) return Response.json({ error: err.message }, { status: err.status });
    console.error("api/contracts/document: failed", err);
    return Response.json({ error: "Could not load the contract." }, { status: 500 });
  }
}
