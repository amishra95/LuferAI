import { z } from "zod";

import { getCurrentMember, type Member } from "@/lib/auth/session";
import { listBookings } from "@/lib/data";
import { buildExpenseReceipt } from "@/lib/finance/receipt";
import { tallyEnvelope, type TallyOptions } from "@/lib/finance/tally-xml";
import { tracer } from "@/lib/tracer";

/**
 * GET → a Tally Prime import file (XML) of a company's confirmed bookings,
 * one voucher each (lib/finance/tally-xml.ts).
 *
 *   from, to          event dates to include, YYYY-MM-DD (inclusive; both optional)
 *   bookingId         just this booking
 *   voucherType       purchase (default) | journal
 *   company           the Tally company to import into
 *   expenseLedger, cgstLedger, sgstLedger, igstLedger, itcPendingLedger,
 *   roundOffLedger    ledger names, when the books use other names
 *   costCategory      the cost category cost centres sit under
 *   companyId         platform admins: which tenant
 *
 * Finance records: Approvers and Finance viewers export their own company's;
 * admins any company's. Organizers can't.
 */
export const dynamic = "force-dynamic";

const EXPORTABLE = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);
const name = z.string().trim().min(1).max(100).optional();
const Query = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    bookingId: z.uuid().optional(),
    voucherType: z.enum(["purchase", "journal"]).default("purchase"),
    company: name,
    expenseLedger: name,
    cgstLedger: name,
    sgstLedger: name,
    igstLedger: name,
    itcPendingLedger: name,
    roundOffLedger: name,
    costCategory: name,
    companyId: z.uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "`from` must be on or before `to`." });

/** The tenant this member may export, or why not. */
function tenantFor(member: Member, requested: string | undefined): { companyId: string } | { status: number; error: string } {
  if (member.role === "ADMIN") return requested ? { companyId: requested } : { status: 400, error: "companyId is required for platform admins." };
  if (member.role === "CLIENT" && member.companyId && (member.corporateRole === "APPROVER" || member.corporateRole === "FINANCE_VIEWER")) {
    return { companyId: member.companyId };
  }
  return { status: 403, error: "Only Approvers and Finance viewers can export to Tally." };
}

async function handleTallyExport(req: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "Sign in to export." }, { status: 401 });

  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid query." }, { status: 400 });
  const q = parsed.data;
  const tenant = tenantFor(member, q.companyId);
  if ("error" in tenant) return Response.json({ error: tenant.error }, { status: tenant.status });

  const bookings = (await listBookings({ companyId: tenant.companyId, ...(q.bookingId && { ids: [q.bookingId] }) }))
    .filter((b) => EXPORTABLE.has(b.status) && (!q.from || b.event_date >= q.from) && (!q.to || b.event_date <= q.to))
    // Day book order: oldest first.
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.id.localeCompare(b.id));
  if (q.bookingId && bookings.length === 0) return Response.json({ error: "No confirmed booking with that id." }, { status: 404 });

  const issuedAt = new Date().toISOString();
  const options: TallyOptions = {
    voucherType: q.voucherType === "journal" ? "Journal" : "Purchase",
    companyName: q.company ?? null,
    costCategory: q.costCategory,
    ledgers: {
      ...(q.expenseLedger && { expense: q.expenseLedger }),
      ...(q.cgstLedger && { cgst: q.cgstLedger }),
      ...(q.sgstLedger && { sgst: q.sgstLedger }),
      ...(q.igstLedger && { igst: q.igstLedger }),
      ...(q.itcPendingLedger && { itcPending: q.itcPendingLedger }),
      ...(q.roundOffLedger && { roundOff: q.roundOffLedger }),
    },
  };
  const xml = tallyEnvelope(
    bookings.map((b) => buildExpenseReceipt(b, issuedAt)),
    options
  );
  tracer.annotate({ vouchers: bookings.length, voucherType: options.voucherType ?? "Purchase" });

  const span = q.bookingId ? q.bookingId.slice(0, 8) : `${q.from ?? "all"}_${q.to ?? issuedAt.slice(0, 10)}`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="tally-vouchers-${span}.xml"`,
      "X-Lufer-Voucher-Count": String(bookings.length),
      "Cache-Control": "no-store",
    },
  });
}

export const GET = tracer.traceResponse("api.finance.tally-export", handleTallyExport);
