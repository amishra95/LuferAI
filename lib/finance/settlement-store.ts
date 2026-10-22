import "server-only";

import { dataSource, listApprovals, listCompanies, listExpenseExports, listPoAllocations, listPurchaseOrders, type BookingDetail } from "@/lib/data";
import { isExpenseProvider, type ExpenseProvider } from "@/lib/finance/expense-adapters";
import { itcStatusOf, itcTags, type ItcStatus, type ItcTag } from "@/lib/finance/itc";
import { poLineRef, settlementTimeline, type SettlementEvent, type SettlementInput } from "@/lib/finance/settlement";
import { createAdminClient } from "@/lib/supabase/admin";

/** What the settlement card shows for one booking. */
export interface SettlementView {
  bookingId: string;
  venueName: string;
  eventDate: string;
  status: string;
  po: { lineRef: string; amountInr: number; allocationStatus: string; overBalance: boolean } | null;
  gst: {
    sacCode: string;
    gstType: string;
    supplyType: string;
    placeOfSupply: string;
    supplierGstin: string;
    recipientGstin: string;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
    invoiceTotal: number;
  };
  itc: { status: ItcStatus; tags: ItcTag[]; note: string | null };
  /** One per provider the booking has been sent to. */
  exports: { provider: ExpenseProvider; status: string; attempts: number; error: string | null; at: string }[];
  /** Where it goes by default (companies.expense_provider). */
  defaultProvider: ExpenseProvider;
  timeline: SettlementEvent[];
}

/** Payments and tax invoices exist only in Supabase. */
async function paymentsAndInvoices(bookingIds: string[]) {
  if (dataSource() !== "supabase" || bookingIds.length === 0) return { payments: [], invoices: [] };
  const db = createAdminClient();
  const [payments, invoices] = await Promise.all([
    db.from("payments").select("*").in("booking_id", bookingIds).order("created_at"),
    db.from("booking_invoices").select("*").in("booking_id", bookingIds).order("sequence"),
  ]);
  if (payments.error) throw payments.error;
  if (invoices.error) throw invoices.error;
  return { payments: payments.data, invoices: invoices.data };
}

/**
 * Settlement views for a company's bookings: PO line, GST breakdown, ITC
 * status and tags, ERP exports and the settlement trail. Batched per company.
 */
export async function settlementsFor(companyId: string, bookings: BookingDetail[]): Promise<SettlementView[]> {
  if (bookings.length === 0) return [];
  const ids = bookings.map((b) => b.id);
  const [companies, pos, allocations, approvals, exports, { payments, invoices }] = await Promise.all([
    listCompanies(),
    listPurchaseOrders({ tenantId: companyId }),
    listPoAllocations({ tenantId: companyId }),
    listApprovals({ tenantId: companyId }),
    listExpenseExports({ tenantId: companyId, limit: 1000 }),
    paymentsAndInvoices(ids),
  ]);
  const company = companies.find((c) => c.id === companyId);
  const defaultProvider: ExpenseProvider = isExpenseProvider(company?.expense_provider) ? company.expense_provider : "webhook";
  const poById = new Map(pos.map((p) => [p.id, p]));

  return bookings.map((b): SettlementView => {
    const allocation = allocations.find((a) => a.booking_id === b.id && a.status !== "released");
    const po = allocation ? poById.get(allocation.po_id) : undefined;
    const mine = exports.filter((e) => e.booking_id === b.id && e.event === "booking.confirmed");
    const input: SettlementInput = {
      booking: b,
      approvals: approvals.filter((a) => a.booking_id === b.id),
      payments: payments.filter((p) => p.booking_id === b.id).map((p) => ({ ...p, amount_inr: Number(p.amount_inr) })),
      invoices: invoices.filter((i) => i.booking_id === b.id).map((i) => ({ ...i, total_inr: Number(i.total_inr) })),
      exports: mine,
    };
    const itc = { status: b.status, itc_decision: b.itc_decision, company_gstin: b.company.gstin, billed_gstin: b.billing_gstin, venue_gstin: b.venue.gstin };
    const inv = b.invoice;
    return {
      bookingId: b.id,
      venueName: b.venue.name,
      eventDate: b.event_date,
      status: b.status,
      po: po && allocation ? { lineRef: poLineRef(po.po_number, allocation.line_number), amountInr: allocation.amount_inr, allocationStatus: allocation.status, overBalance: allocation.over_balance } : null,
      gst: {
        sacCode: inv.sac.code,
        gstType: inv.gst_type,
        supplyType: inv.supply_type,
        placeOfSupply: `${inv.place_of_supply.state_code} ${inv.place_of_supply.state_name}`,
        supplierGstin: inv.supplier.gstin,
        recipientGstin: inv.recipient.gstin,
        taxableValue: inv.taxable_value,
        cgst: inv.tax_breakup.cgst.amount,
        sgst: inv.tax_breakup.sgst.amount,
        igst: inv.tax_breakup.igst.amount,
        totalTax: inv.total_tax,
        invoiceTotal: inv.invoice_total,
      },
      itc: { status: itcStatusOf(itc), tags: itcTags({ ...itc, sac_code: b.sac_code, gst_type: b.gst_type }), note: b.itc_note },
      exports: mine.flatMap((e) => (isExpenseProvider(e.provider) ? [{ provider: e.provider, status: e.status, attempts: e.attempts, error: e.error, at: e.updated_at }] : [])),
      defaultProvider,
      timeline: settlementTimeline(input),
    };
  });
}
