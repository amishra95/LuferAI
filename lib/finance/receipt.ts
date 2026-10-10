/**
 * Structured expense receipt for finance systems (ERP / expense tools). Pure,
 * so tests/enterprise.test.mjs can check it. The shape is versioned via
 * `schema`; add fields, never repurpose them.
 */
import type { TaxInvoicePayload } from "../gst-engine.ts";

export const RECEIPT_SCHEMA = "lufer.expense-receipt/v1";

export interface ReceiptBooking {
  id: string;
  status: string;
  event_date: string;
  party_size: number;
  budget_per_head_inr: number;
  total_amount_inr: number;
  notes: string | null;
  cost_center: string | null;
  project_code: string | null;
  billing_gstin: string | null;
  commission_rate: number;
  commission_inr: number;
  company: { id: string; legal_name: string; gstin: string };
  venue: { id: string; name: string; city: string; gstin: string };
  invoice: TaxInvoicePayload;
}

export type ReceiptEvent = "booking.confirmed" | "order.confirmed";

export interface ExpenseReceipt {
  schema: typeof RECEIPT_SCHEMA;
  event: ReceiptEvent;
  issued_at: string;
  booking: { id: string; status: string; event_date: string; party_size: number; notes: string | null };
  buyer: { company_id: string; legal_name: string; registered_gstin: string; billed_gstin: string; place_of_supply: string };
  supplier: { venue_id: string; name: string; city: string; gstin: string };
  expense: { cost_center: string | null; project_code: string | null };
  tax: {
    sac_code: string;
    gst_type: string;
    supply_type: string;
    taxable_value: number;
    cgst: number;
    sgst: number;
    igst: number;
    total_tax: number;
    invoice_total: number;
    itc_eligible_amount: number;
  };
  amounts: { currency: "INR"; per_head: number; party_size: number };
  platform: { commission_rate: number; commission_inr: number };
}

/** `event` is "order.confirmed" for catalogue orders (the supplier is in `venue`, units in `party_size`). */
export function buildExpenseReceipt(b: ReceiptBooking, issuedAt: string, event: ReceiptEvent = "booking.confirmed"): ExpenseReceipt {
  const inv = b.invoice;
  return {
    schema: RECEIPT_SCHEMA,
    event,
    issued_at: issuedAt,
    booking: { id: b.id, status: b.status, event_date: b.event_date, party_size: b.party_size, notes: b.notes },
    buyer: {
      company_id: b.company.id,
      legal_name: b.company.legal_name,
      registered_gstin: b.company.gstin,
      billed_gstin: b.billing_gstin ?? b.company.gstin,
      place_of_supply: `${inv.place_of_supply.state_code} ${inv.place_of_supply.state_name}`,
    },
    supplier: { venue_id: b.venue.id, name: b.venue.name, city: b.venue.city, gstin: b.venue.gstin },
    expense: { cost_center: b.cost_center, project_code: b.project_code },
    tax: {
      sac_code: inv.sac.code,
      gst_type: inv.gst_type,
      supply_type: inv.supply_type,
      taxable_value: inv.taxable_value,
      cgst: inv.tax_breakup.cgst.amount,
      sgst: inv.tax_breakup.sgst.amount,
      igst: inv.tax_breakup.igst.amount,
      total_tax: inv.total_tax,
      invoice_total: inv.invoice_total,
      itc_eligible_amount: inv.itc_eligible_amount,
    },
    amounts: { currency: "INR", per_head: b.budget_per_head_inr, party_size: b.party_size },
    platform: { commission_rate: b.commission_rate, commission_inr: b.commission_inr },
  };
}
