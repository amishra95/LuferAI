/**
 * The negotiated terms a contract is generated from (migration 0031): one
 * snapshot of the booking's price, headcount, date, the venue's rules
 * (minimum spend, cancellation, deposit), the expense details, and the
 * Sprint 5 sign-offs that approved it. Stored on contracts.terms exactly as
 * rendered, so the agreement never changes when the underlying rows do.
 *
 * Pure: tests import it directly (tests/contracts.test.mjs).
 */

import type { CancellationTier } from "../../venues/profile.ts";

export interface ContractParty {
  legalName: string;
  gstin: string;
  /** Registered address (venues) or contact email (companies). */
  address: string | null;
  email: string | null;
}

export interface ContractApproval {
  step: number;
  approverName: string;
  decidedAt: string | null;
  note: string | null;
  /** True when it took over an escalated step. */
  escalated: boolean;
}

export interface ContractInstalment {
  kind: "deposit" | "balance";
  /** GST-inclusive amount. */
  total: number;
  /** "on execution", or YYYY-MM-DD. */
  due: string;
}

export interface ContractTerms {
  contractNumber: string;
  revision: number;
  /** YYYY-MM-DD (IST). */
  issuedOn: string;
  bookingId: string;
  client: ContractParty & { billingGstin: string | null };
  venue: ContractParty & { name: string; neighborhood: string; city: string };
  event: {
    date: string;
    partySize: number;
    alcoholIncluded: boolean;
    entertainment: string[];
    notes: string | null;
    costCenter: string | null;
    projectCode: string | null;
    department: string | null;
    poNumber: string | null;
  };
  pricing: {
    /** Per head before the corporate rate card; null = list price. */
    listPerHead: number | null;
    perHead: number;
    rateCardApplied: boolean;
    taxable: number;
    gstType: "CGST_SGST" | "IGST";
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
    invoiceTotal: number;
    sacCode: string;
    gstRatePercent: number;
  };
  venueRules: {
    minimumSpend: number;
    minimumPerHead: number;
    cancellation: CancellationTier[];
  };
  payment: {
    depositRate: number;
    instalments: ContractInstalment[];
  };
  approvals: ContractApproval[];
  approvalReason: string | null;
}

/** "LUF-1A2B3C4D-R2": stable per booking and revision. */
export function contractNumber(bookingId: string, revision: number): string {
  return `LUF-${bookingId.replace(/-/g, "").slice(0, 8).toUpperCase()}-R${revision}`;
}

/** YYYY-MM-DD in India, for "issued on" and invoice dates. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export interface TermsInput {
  booking: {
    id: string;
    event_date: string;
    party_size: number;
    budget_per_head_inr: number;
    list_budget_per_head_inr: number | null;
    total_amount_inr: number;
    rate_card_id: string | null;
    alcohol_included: boolean;
    entertainment: string[];
    notes: string | null;
    cost_center: string | null;
    project_code: string | null;
    billing_gstin: string | null;
  };
  company: { legal_name: string; gstin: string; primary_contact_email: string | null };
  venue: { name: string; neighborhood: string; city: string; address: string | null; gstin: string; min_spend_inr: number; min_spend_per_head_inr: number };
  /** lib/gst-engine calculateGst for the booking. */
  invoice: {
    taxable_value: number;
    gst_type: "CGST_SGST" | "IGST";
    tax_breakup: { cgst: { amount: number }; sgst: { amount: number }; igst: { amount: number } };
    total_tax: number;
    invoice_total: number;
    sac: { code: string };
    tax?: { rate_percent: number };
  };
  cancellation: CancellationTier[];
  depositRate: number;
  instalments: ContractInstalment[];
  department: string | null;
  poNumber: string | null;
  /** The booking's decided approvals, any order. */
  approvals: { step: number; approverName: string; status: string; decidedAt: string | null; note: string | null; escalatedFrom: string | null }[];
  approvalReason: string | null;
  revision: number;
  issuedAt: Date;
}

/** Merges the booking's rows into the terms the template renders. Approved sign-offs only, in step order. */
export function buildContractTerms(input: TermsInput): ContractTerms {
  const { booking: b, company, venue, invoice } = input;
  return {
    contractNumber: contractNumber(b.id, input.revision),
    revision: input.revision,
    issuedOn: istDate(input.issuedAt),
    bookingId: b.id,
    client: { legalName: company.legal_name, gstin: company.gstin, billingGstin: b.billing_gstin, address: null, email: company.primary_contact_email },
    venue: { legalName: venue.name, name: venue.name, neighborhood: venue.neighborhood, city: venue.city, gstin: venue.gstin, address: venue.address, email: null },
    event: {
      date: b.event_date,
      partySize: b.party_size,
      alcoholIncluded: b.alcohol_included,
      entertainment: [...b.entertainment].sort(),
      notes: b.notes?.trim() || null,
      costCenter: b.cost_center,
      projectCode: b.project_code,
      department: input.department,
      poNumber: input.poNumber,
    },
    pricing: {
      listPerHead: b.list_budget_per_head_inr === null ? null : Number(b.list_budget_per_head_inr),
      perHead: Number(b.budget_per_head_inr),
      rateCardApplied: b.rate_card_id !== null,
      taxable: invoice.taxable_value,
      gstType: invoice.gst_type,
      cgst: invoice.tax_breakup.cgst.amount,
      sgst: invoice.tax_breakup.sgst.amount,
      igst: invoice.tax_breakup.igst.amount,
      totalTax: invoice.total_tax,
      invoiceTotal: invoice.invoice_total,
      sacCode: invoice.sac.code,
      gstRatePercent: invoice.tax?.rate_percent ?? 18,
    },
    venueRules: { minimumSpend: Number(venue.min_spend_inr), minimumPerHead: Number(venue.min_spend_per_head_inr), cancellation: input.cancellation },
    payment: { depositRate: input.depositRate, instalments: input.instalments },
    approvals: input.approvals
      .filter((a) => a.status === "APPROVED")
      .sort((x, y) => x.step - y.step || (x.decidedAt ?? "").localeCompare(y.decidedAt ?? ""))
      .map((a) => ({ step: a.step, approverName: a.approverName, decidedAt: a.decidedAt, note: a.note?.trim() || null, escalated: a.escalatedFrom !== null })),
    approvalReason: input.approvalReason,
  };
}
