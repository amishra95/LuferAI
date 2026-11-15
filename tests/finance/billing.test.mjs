// Run with: npm test
//
// Billing after the event (lib/finance/billing-rules.ts, the documents in
// lib/finance/tax-invoice-document.ts, and the event page's invoice row).
import { test } from "node:test";
import assert from "node:assert/strict";

import { balanceDue, indianFiscalYear, invoiceDue, invoiceNumber, invoiceWaitingReason, splitInclusive, voucherNumber } from "../../lib/finance/billing-rules.ts";
import { documentHtml, renderPaymentReceipt, renderReceiptVoucher, renderRefundVoucher, renderTaxInvoice } from "../../lib/finance/tax-invoice-document.ts";
import { amountInWords } from "../../lib/finance/amount-words.ts";
import { documentFilename, pdfText, renderDocumentPdf } from "../../lib/finance/document-pdf.ts";
import { balanceReadiness, depositReadiness } from "../../lib/events/finance.ts";
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
  assert.match(doc.html, /Balance payable<\/td><td><\/td><td class="num"><\/td><td class="num">₹88,500\.00/);
  assert.match(doc.html, /Amount in words: Rupees One Lakh Eighteen Thousand Only/);
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

test("amount in words: lakh and crore, paise, zero", () => {
  assert.equal(amountInWords(118000), "Rupees One Lakh Eighteen Thousand Only");
  assert.equal(amountInWords(29500.5), "Rupees Twenty Nine Thousand Five Hundred and Fifty Paise Only");
  assert.equal(amountInWords(0), "Rupees Zero Only");
  assert.equal(amountInWords(12345678.09), "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Nine Paise Only");
  assert.equal(amountInWords(1000), "Rupees One Thousand Only");
  assert.equal(amountInWords(100), "Rupees One Hundred Only");
  assert.equal(amountInWords(19), "Rupees Nineteen Only");
  assert.equal(amountInWords(15000000000), "Rupees One Thousand Five Hundred Crore Only");
});

const voucherBase = (b) => ({
  issuedOn: "2026-11-12",
  bookingId: b.id,
  eventDate: b.event_date,
  supplierName: b.venue.name,
  supplierCity: b.venue.city,
  supplierAddress: null,
  recipientName: b.company.legal_name,
  recipientAddress: "4th Floor, Prestige Tech Park, Bengaluru 560103",
  invoice: b.invoice,
});

test("refund voucher: numbered, the refund split into taxable value and GST, tied to the receipt voucher", () => {
  const b = bookingFixture();
  const doc = renderRefundVoucher({ ...voucherBase(b), voucherNumber: "RFV/2026-27/000001", refunded: splitInclusive(14750, 18, true), receiptVoucherNumber: "RV/2026-27/000003", refundRef: "rfnd_9" });
  assert.match(doc.html, /<h1>Refund Voucher<\/h1>/);
  assert.match(doc.html, /Voucher no\. RFV\/2026-27\/000001 · date 2026-11-12/);
  assert.match(doc.html, /receipt voucher RV\/2026-27\/000003/);
  assert.match(doc.html, /refund rfnd_9/);
  assert.match(doc.html, /CGST @ 9%<\/td><td><\/td><td class="num">₹1,125\.00/);
  assert.match(doc.html, /Amount refunded<\/td><td><\/td><td class="num">₹14,750\.00/);
  assert.match(doc.html, /Refunded to/);
  assert.equal(doc.model.kind, "refund_voucher");
});

test("payment receipt: the balance against the invoice, paid in full or still owing", () => {
  const b = bookingFixture();
  const subject = { ...voucherBase(b), invoiceNumber: "2026-27/000001", invoiceDate: "2026-11-20", paidOn: "2026-11-22", advance: 29500, paid: 88500, paymentRef: "pay_77" };
  const full = renderPaymentReceipt(subject);
  assert.match(full.html, /Against tax invoice 2026-27\/000001 dated 2026-11-20 · received 2026-11-22/);
  assert.match(full.html, /Less: advance received<\/td><td class="num">− ₹29,500\.00/);
  assert.match(full.html, /Amount received<\/td><td class="num">₹88,500\.00/);
  assert.match(full.html, /Paid in full/);
  const part = renderPaymentReceipt({ ...subject, paid: 50000 });
  assert.match(part.html, /Still payable<\/td><td class="num">₹38,500\.00/);
});

test("the stored model renders the same HTML again, and a real PDF", async () => {
  const b = bookingFixture();
  const doc = renderTaxInvoice({
    bookingId: b.id,
    eventDate: b.event_date,
    partySize: b.party_size,
    supplierName: b.venue.name,
    supplierCity: b.venue.city,
    recipientName: b.company.legal_name,
    recipientAddress: "4th Floor, Prestige Tech Park, Bengaluru 560103",
    invoice: { ...b.invoice, invoice_number: "2026-27/000001", invoice_date: "2026-11-20" },
    advance: { amount: 29500, voucherNumber: "RV/2026-27/000003" },
  });
  // What the database keeps (jsonb) is enough to make the document again.
  const stored = JSON.parse(JSON.stringify(doc.model));
  assert.equal(documentHtml(stored), doc.html);

  const pdf = await renderDocumentPdf(stored);
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString("latin1"), "%PDF-");
  assert.ok(pdf.length > 1500);
  assert.deepEqual(Buffer.from(await renderDocumentPdf(stored)), Buffer.from(pdf), "deterministic");
  assert.equal(documentFilename(stored, "pdf"), "Tax-Invoice-2026-27-000001.pdf");
  assert.equal(pdfText("− ₹1,18,000.00"), "- Rs. 1,18,000.00");
  assert.equal(pdfText("Café “Ōsaka” ₹5"), 'Café "?saka" Rs. 5');
});

test("event page: deposit refunds and the invoice balance", () => {
  assert.deepEqual(depositReadiness("CANCELLED", { status: "refunded", amount_inr: 29500, refunded_inr: 29500 }, true).label, "Deposit refunded · ₹29,500");
  assert.match(depositReadiness("CANCELLED", { status: "captured", amount_inr: 29500, refunded_inr: 14750 }, true).hint, /₹14,750 of it was refunded/);
  assert.equal(depositReadiness("CANCELLED", { status: "refunded", amount_inr: 29500 }, true).label, "Deposit released · ₹29,500", "a Stripe hold released, nothing refunded");
  assert.equal(balanceReadiness(null), null);
  assert.deepEqual([balanceReadiness({ advance: 29500, paid: 0, outstanding: 88500 }).tone, balanceReadiness({ advance: 29500, paid: 0, outstanding: 88500 }).label], ["pending", "Balance due · ₹88,500"]);
  assert.equal(balanceReadiness({ advance: 29500, paid: 88500, outstanding: 0 }).label, "Balance paid · ₹88,500");
  assert.equal(balanceReadiness({ advance: 118000, paid: 0, outstanding: 0 }).label, "Paid in full");
});
