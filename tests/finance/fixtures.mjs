// Shared fixtures for tests/finance: valid GSTINs and a receipt built through the real engine.
import { calculateGst, computeGstinChecksum } from "../../lib/gst-engine.ts";
import { buildExpenseReceipt } from "../../lib/finance/receipt.ts";

const gstin = (first14) => first14 + computeGstinChecksum(first14);

/** Nimbus (Karnataka) and a branch of the same legal entity (same PAN) in Maharashtra. */
export const NIMBUS_KA = "29AABCN4821K1ZA";
export const NIMBUS_MH = gstin("27AABCN4821K1Z");
/** Venues: one in Karnataka, one in Maharashtra; and another company entirely. */
export const VENUE_KA = gstin("29AAFCV1234M1Z");
export const VENUE_MH = gstin("27AAFCM5678P1Z");
export const OTHER_CO = gstin("29AAACX9999Q1Z");

/** A confirmed booking as the dispatcher sees it, priced by the GST engine. */
export function booking({ status = "COMPLETED", venueGstin = VENUE_KA, billing = null, itc_decision = null, party = 40, perHead = 2500 } = {}) {
  const total = party * perHead;
  return {
    id: "bbbbbbbb-0001-4000-8000-000000000001",
    status,
    event_date: "2026-11-06",
    party_size: party,
    budget_per_head_inr: perHead,
    total_amount_inr: total,
    notes: null,
    cost_center: "ENG-BLR",
    project_code: "Q4-OFFSITE",
    billing_gstin: billing,
    commission_rate: 0.15,
    commission_inr: total * 0.15,
    company: { id: "11111111-1111-4111-8111-111111111111", legal_name: "Nimbus Analytics Private Limited", gstin: NIMBUS_KA },
    venue: { id: "aaaaaaaa-0001-4000-8000-000000000001", name: "The Copper Courtyard", city: "Bengaluru", gstin: venueGstin },
    invoice: calculateGst({ total_amount: total, company_gstin: billing ?? NIMBUS_KA, venue_gstin: venueGstin, booking_id: "bbbbbbbb-0001-4000-8000-000000000001", invoice_date: "2026-11-06" }),
    itc_decision,
  };
}

export const receipt = (opts) => buildExpenseReceipt(booking(opts), "2026-11-07T10:00:00.000Z");
