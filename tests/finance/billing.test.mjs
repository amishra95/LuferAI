// Run with: npm test
//
// Billing after the event (lib/finance/billing-rules.ts, the documents in
// lib/finance/tax-invoice-document.ts, and the event page's invoice row).
import { test } from "node:test";
import assert from "node:assert/strict";

import { balanceDue, indianFiscalYear, invoiceDue, invoiceNumber, invoiceWaitingReason, splitInclusive, voucherNumber } from "../../lib/finance/billing-rules.ts";
import { renderReceiptVoucher, renderTaxInvoice } from "../../lib/finance/tax-invoice-document.ts";
import { taxInvoiceReadiness } from "../../lib/events/finance.ts";
import { booking as bookingFixture, VENUE_MH } from "./fixtures.mjs";

test("due once the event has happened: completed or settled, or confirmed with its date past", () => {
  assert.equal(invoiceDue({ status: "COMPLETED", event_date: "2026-12-01" }, "2026-11-11"), true, "venue marked it complete");
  assert.equal(invoiceDue({ status: "SETTLED", event_date: "2026-11-01" }, "2026-11-11"), true);
  assert.equal(invoiceDue({ status: "CONFIRMED", event_date: "2026-11-10" }, "2026-11-11"), true, "the day after");
  assert.equal(invoiceDue({ status: "CONFIRMED", event_date: "2026-11-11" }, "2026-11-11"), false, "not on the day itself");
  for (const status of ["PENDING_APPROVAL", "PENDING", "CANCELLED"]) assert.equal(invoiceDue({ status, event_date: "2026-01-01" }, "2026-11-11"), false, status);
  assert.equal(invoiceWaitingReason({ status: "COMPLETED", event_date: "2026-11-01" }, { billing_address: "  " }, "2026-11-11"), "address");
  assert.equal(invoiceWaitingReason({ status: "COMPLETED", event_date: "2026-11-01" }, { billing_address: "12 MG Road, Bengaluru 560001" }, "2026-11-11"), null);
});

test("Indian FY and the series formats (as public.indian_fiscal_year)", () => {
  assert.equal(indianFiscalYear("2026-04-01"), "2026-27");
  assert.equal(indianFiscalYear("2027-03-31"), "2026-27");
  assert.equal(indianFiscalYear("2026-01-15"), "2025-26");
  assert.equal(indianFiscalYear("2099-12-31"), "2099-00");
  assert.equal(invoiceNumber("2026-27", 42), "2026-27/000042");
  assert.equal(voucherNumber("2026-27", 7), "RV/2026-27/000007");
});

test("an advance including 18% GST splits back into taxable value and tax that add up exactly", () => {
  const intra = splitInclusive(29500, 18, true);
  assert.deepEqual(intra, { total: 29500, taxable: 25000, tax: 4500, cgst: 2250, sgst: 2250, igst: 0 });
  const odd = splitInclusive(1000.01, 18, true);
  assert.equal(Math.round((odd.taxable + odd.cgst + odd.sgst) * 100), 100001, "no paisa lost");
  assert.ok(odd.cgst >= odd.sgst && odd.cgst - odd.sgst <= 0.01);
  assert.deepEqual(splitInclusive(1180, 18, false), { total: 1180, taxable: 1000, tax: 180, cgst: 0, sgst: 0, igst: 180 });
  assert.equal(balanceDue(118000, 29500), 88500);
  assert.equal(balanceDue(100, 150), 0);
});

test("tax invoice: addresses, the advance set against it and the balance payable", () => {
  const b = bookingFixture();
  const doc = renderTaxInvoice({
    bookingId: b.id,
    eventDate: b.event_date,
    partySize: b.party_size,
    supplierName: b.venue.name,
    supplierCity: b.venue.city,
    supplierAddress: "12th Main, Indiranagar, Bengaluru 560038",
    recipientName: b.company.legal_name,
    recipientAddress: "4th Floor, Prestige Tech Park, Bengaluru 560103",
    invoice: { ...b.invoice, invoice_number: "2026-27/000001", invoice_date: "2026-11-20" },
    advance: { amount: 29500, voucherNumber: "RV/2026-27/000003" },
  });
  assert.match(doc.html, /Invoice no\. 2026-27\/000001 · date 2026-11-20/);
  assert.match(doc.html, /12th Main, Indiranagar/);
  assert.match(doc.html, /4th Floor, Prestige Tech Park/);
  assert.match(doc.html, /Less: advance received \(receipt voucher RV\/2026-27\/000003\)/);
  assert.match(doc.html, /Balance payable<\/td><td><\/td><td><\/td><td class="num">₹88,500\.00/);
  assert.match(doc.html, /Authorised signatory/);
});

test("receipt voucher: numbered, the deposit split into taxable value and GST heads, inter-state as IGST", () => {
  const b = bookingFixture();
  const subject = (invoice, received) => ({
    voucherNumber: "RV/2026-27/000001",
    issuedOn: "2026-11-05",
    bookingId: b.id,
    eventDate: b.event_date,
    partySize: b.party_size,
    supplierName: b.venue.name,
    supplierCity: b.venue.city,
    supplierAddress: null,
    recipientName: b.company.legal_name,
    recipientAddress: "4th Floor, Prestige Tech Park, Bengaluru 560103",
    invoice,
    received,
    paymentRef: "pay_123",
  });
  const intra = renderReceiptVoucher(subject(b.invoice, splitInclusive(29500, 18, true)));
  assert.match(intra.html, /<h1>Receipt Voucher<\/h1>/);
  assert.match(intra.html, /Voucher no\. RV\/2026-27\/000001 · date 2026-11-05/);
  assert.match(intra.html, /CGST @ 9%<\/td><td><\/td><td class="num">₹2,250\.00/);
  assert.match(intra.html, /Amount received<\/td><td><\/td><td class="num">₹29,500\.00/);
  assert.match(intra.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(renderReceiptVoucher(subject(b.invoice, splitInclusive(29500, 18, true))), intra, "deterministic");
  const inter = bookingFixture({ venueGstin: VENUE_MH });
  const igst = renderReceiptVoucher(subject(inter.invoice, splitInclusive(29500, 18, false)));
  assert.match(igst.html, /IGST @ 18%/);
  assert.doesNotMatch(igst.html, /CGST/);
});

test("event page invoice row: after the event, address prompt, issued, contract, cancelled", () => {
  assert.equal(taxInvoiceReadiness("CONFIRMED", null, "event").label, "Invoice after the event");
  assert.equal(taxInvoiceReadiness("PENDING", null, "event").label, "Invoice after the event");
  const address = taxInvoiceReadiness("COMPLETED", null, "address");
  assert.deepEqual([address.tone, address.label], ["problem", "Add your billing address"]);
  assert.equal(taxInvoiceReadiness("COMPLETED", null, null).label, "Invoice being issued");
  assert.deepEqual([taxInvoiceReadiness("COMPLETED", { invoiceNumber: "2026-27/000001" }, null).tone, taxInvoiceReadiness("COMPLETED", { invoiceNumber: "2026-27/000001" }, null).label], ["done", "Tax invoice 2026-27/000001"]);
  assert.equal(taxInvoiceReadiness("CONFIRMED", null, "event", true).label, "Billed by contract");
  assert.equal(taxInvoiceReadiness("CANCELLED", null, "event").label, "No invoice");
});
