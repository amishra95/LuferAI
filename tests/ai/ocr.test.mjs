// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Invoice OCR checks: normalising what the model reads
// (lib/ai/invoice-schema.ts), reconciling it with the booking
// (lib/finance/invoice-reconcile.ts), and the route end to end
// (app/api/finance/ocr-reconcile) through the real model router, with
// Gemini's HTTP API stubbed. The check never decides ITC: that stays with
// approvers (setItcDecision).
import { signIn } from "../support/server-actions.mjs";
import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { isInvoiceMediaType, MAX_INVOICE_BYTES, normalizeGstin, normalizeInvoice, normalizeInvoiceDate } from "../../lib/ai/invoice-schema.ts";
import { reconcileInvoice, RECONCILE_TOLERANCE_INR } from "../../lib/finance/invoice-reconcile.ts";
import { booking, NIMBUS_KA, OTHER_CO, VENUE_KA, VENUE_MH } from "../finance/fixtures.mjs";

const { POST } = await import("../../app/api/finance/ocr-reconcile/route.ts");
const { listBookings } = await import("../../lib/data/index.ts");
const { mutateDb } = await import("../../lib/data/local-store.ts");

// ---------------------------------------------------------------------------
// Normalising the model's output
// ---------------------------------------------------------------------------

test("GSTINs are upper-cased with spaces and dashes removed", () => {
  assert.equal(normalizeGstin(" 29 aabcn-4821k1za "), "29AABCN4821K1ZA");
  assert.equal(normalizeGstin(""), null);
  assert.equal(normalizeGstin(null), null);
});

test("dates: ISO kept, Indian day-first dates converted, impossible dates refused", () => {
  assert.equal(normalizeInvoiceDate("2026-12-05"), "2026-12-05");
  assert.equal(normalizeInvoiceDate("05/12/2026"), "2026-12-05");
  assert.equal(normalizeInvoiceDate("5-12-2026"), "2026-12-05");
  assert.equal(normalizeInvoiceDate("05.12.2026"), "2026-12-05");
  for (const bad of ["31/02/2026", "2026-13-01", "12/31/2026", "Dec 5 2026", "", null]) assert.equal(normalizeInvoiceDate(bad), null, String(bad));
});

test("normalizeInvoice rounds amounts to the paisa and cleans text, without inventing values", () => {
  const n = normalizeInvoice({
    vendor_gstin: "29aafcv1234m1z1",
    buyer_gstin: null,
    invoice_number: "  INV/26/042 ",
    invoice_date: "16/10/2026",
    subtotal: 100000.004,
    cgst: 9000,
    sgst: 9000,
    igst: null,
    total_amount: Number.NaN,
    line_items: [{ description: " Buffet dinner ", hsn_sac: "9985 96", quantity: 40, unit_price: 2500, amount: 100000 }],
  });
  assert.deepEqual(n, {
    vendor_gstin: "29AAFCV1234M1Z1",
    buyer_gstin: null,
    invoice_number: "INV/26/042",
    invoice_date: "2026-10-16",
    subtotal: 100000,
    cgst: 9000,
    sgst: 9000,
    igst: null,
    total_amount: null,
    line_items: [{ description: "Buffet dinner", hsn_sac: "998596", quantity: 40, unit_price: 2500, amount: 100000 }],
  });
});

test("accepted uploads: PDFs and phone image formats under 4 MB", () => {
  for (const t of ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]) assert.equal(isInvoiceMediaType(t), true, t);
  for (const t of ["text/html", "application/zip", "image/svg+xml", ""]) assert.equal(isInvoiceMediaType(t), false, t);
  assert.equal(MAX_INVOICE_BYTES, 4 * 1024 * 1024);
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** The invoice a venue should send for a fixture booking: exactly its GST engine figures. */
function matchingInvoice(b = booking()) {
  const inv = b.invoice;
  return {
    vendor_gstin: b.venue.gstin,
    buyer_gstin: b.billing_gstin ?? b.company.gstin,
    invoice_number: "INV/26/042",
    invoice_date: "2026-11-06",
    subtotal: inv.taxable_value,
    cgst: inv.tax_breakup.cgst.amount,
    sgst: inv.tax_breakup.sgst.amount,
    igst: inv.tax_breakup.igst.amount,
    total_amount: inv.invoice_total,
    line_items: [{ description: "Corporate dinner, 40 guests", hsn_sac: "998596", quantity: 40, unit_price: 2500, amount: inv.taxable_value }],
  };
}
const reconcile = (invoice, b = booking(), today = "2026-11-10") =>
  reconcileInvoice({ invoice, expected: b.invoice, venueGstin: b.venue.gstin, billedGstin: b.billing_gstin ?? b.company.gstin, today });
const codes = (r) => r.findings.map((f) => f.code);
const blocking = (r) => r.findings.filter((f) => f.severity === "block").map((f) => f.code);

test("an invoice matching the booking passes the check", () => {
  const r = reconcile(matchingInvoice());
  assert.deepEqual(r, { status: "verified", findings: [], note: "Invoice INV/26/042 matched the booking (OCR check)." });
});

test("an inter-state invoice charging IGST matches an inter-state booking", () => {
  const b = booking({ venueGstin: VENUE_MH });
  assert.equal(reconcile(matchingInvoice(b), b).status, "verified");
});

test("round-off within ₹1 per figure is accepted; more is a mismatch", () => {
  assert.equal(RECONCILE_TOLERANCE_INR, 1);
  assert.equal(reconcile({ ...matchingInvoice(), subtotal: 100000.6, total_amount: 118000.6 }).status, "verified");
  const r = reconcile({ ...matchingInvoice(), subtotal: 100002, total_amount: 118002 });
  assert.deepEqual(blocking(r), ["SUBTOTAL_MISMATCH", "TOTAL_MISMATCH"]);
  assert.equal(r.findings[0].expected, 100000);
  assert.equal(r.findings[0].found, 100002);
});

test("supplier GSTIN: missing, invalid and someone else's all block", () => {
  assert.deepEqual(blocking(reconcile({ ...matchingInvoice(), vendor_gstin: null })), ["VENDOR_GSTIN_MISSING"]);
  assert.deepEqual(blocking(reconcile({ ...matchingInvoice(), vendor_gstin: "29AAFCV1234M1Z9" })), ["VENDOR_GSTIN_INVALID"]);
  const r = reconcile({ ...matchingInvoice(), vendor_gstin: OTHER_CO });
  assert.deepEqual(blocking(r), ["VENDOR_GSTIN_MISMATCH"]);
  assert.equal(r.status, "discrepancies");
});

test("recipient GSTIN: missing or not the billed GSTIN blocks the credit", () => {
  assert.deepEqual(blocking(reconcile({ ...matchingInvoice(), buyer_gstin: null })), ["BUYER_GSTIN_MISSING"]);
  const r = reconcile({ ...matchingInvoice(), buyer_gstin: OTHER_CO });
  assert.deepEqual(blocking(r), ["BUYER_GSTIN_MISMATCH"]);
  assert.match(r.note, new RegExp(`Billed to ${OTHER_CO}, not ${NIMBUS_KA}`));
});

test("IGST on an intra-state supply, or CGST + SGST on an inter-state one, is the wrong tax type", () => {
  const intra = booking();
  const r = reconcile({ ...matchingInvoice(), cgst: 0, sgst: 0, igst: 18000 });
  assert.deepEqual(blocking(r), ["TAX_TYPE_MISMATCH"], "reported once, not as three head mismatches");
  assert.equal(r.findings[0].expected, "CGST_SGST");
  assert.equal(intra.invoice.gst_type, "CGST_SGST");

  const inter = booking({ venueGstin: VENUE_MH });
  const r2 = reconcile({ ...matchingInvoice(inter), cgst: 9000, sgst: 9000, igst: 0 }, inter);
  assert.deepEqual(blocking(r2), ["TAX_TYPE_MISMATCH"]);
  assert.equal(r2.findings[0].expected, "IGST");
});

test("an overcharged tax head is flagged, with the total", () => {
  const r = reconcile({ ...matchingInvoice(), cgst: 9500, total_amount: 118500 });
  assert.deepEqual(blocking(r), ["CGST_MISMATCH", "TOTAL_MISMATCH"]);
  assert.match(r.note, /CGST is ₹9,500\.00; the booking is ₹9,000\.00\./);
});

test("an invoice whose own figures don't add up is blocked", () => {
  const r = reconcile({ ...matchingInvoice(), total_amount: 118000, subtotal: 100000, cgst: 9000, sgst: 8000 });
  assert.ok(blocking(r).includes("ARITHMETIC_ERROR"));
});

test("unreadable amounts block: the credit can't be checked", () => {
  const r = reconcile({ ...matchingInvoice(), subtotal: null, total_amount: null });
  assert.deepEqual(blocking(r), ["AMOUNT_UNREADABLE", "AMOUNT_UNREADABLE"]);
});

test("document fields: no invoice number or a future date blocks; an unreadable date only warns", () => {
  assert.deepEqual(blocking(reconcile({ ...matchingInvoice(), invoice_number: null })), ["INVOICE_NUMBER_MISSING"]);
  assert.deepEqual(blocking(reconcile({ ...matchingInvoice(), invoice_date: "2026-12-01" })), ["INVOICE_DATE_FUTURE"]);
  const r = reconcile({ ...matchingInvoice(), invoice_date: null });
  assert.equal(r.status, "verified");
  assert.deepEqual(codes(r), ["INVOICE_DATE_MISSING"]);
});

test("line items that don't sum to the subtotal, or another SAC code, warn without blocking", () => {
  const r = reconcile({
    ...matchingInvoice(),
    line_items: [
      { description: "Dinner", hsn_sac: "996331", quantity: 40, unit_price: 2000, amount: 80000 },
      { description: "AV", hsn_sac: null, quantity: 1, unit_price: 5000, amount: 5000 },
    ],
  });
  assert.equal(r.status, "verified");
  assert.deepEqual(codes(r), ["LINE_ITEMS_MISMATCH", "SAC_MISMATCH"]);
});

test("the note lists every blocking reason and fits bookings.itc_note", () => {
  const r = reconcile({ ...matchingInvoice(), vendor_gstin: null, buyer_gstin: null, invoice_number: null, subtotal: 1, cgst: 1, sgst: 1, total_amount: 999999 });
  assert.equal(r.status, "discrepancies");
  assert.ok(r.note.length <= 500);
  assert.match(r.note, /^Invoice: The supplier's GSTIN/);
});

// ---------------------------------------------------------------------------
// The route, with Gemini's API stubbed
// ---------------------------------------------------------------------------

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const CONFIRMED = "bbbbbbbb-0001-4000-8000-000000000001"; // Nimbus; set to COMPLETED below when a test needs it invoiced
const VERTEX_BOOKING = "bbbbbbbb-0002-4000-8000-000000000002";
const APPROVER = "dddddddd-0002-4000-8000-000000000002";
const AI_KEYS = ["GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "GEMINI_MODEL"];
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]); // "%PDF-1.7\n"

let geminiCalls = [];
/** What the stubbed Gemini answers: the JSON text of its one candidate. */
let geminiText = "{}";
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://generativelanguage.googleapis.com/")) return realFetch(input, init);
    geminiCalls.push({ url, body: JSON.parse(init.body) });
    return Response.json({
      candidates: [{ content: { role: "model", parts: [{ text: geminiText }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 150, totalTokenCount: 1350 },
    });
  };
});
after(() => {
  globalThis.fetch = realFetch;
  for (const k of AI_KEYS) delete process.env[k];
  signIn(null);
});

let seeded;
beforeEach(async () => {
  for (const k of AI_KEYS) delete process.env[k];
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-gemini-key";
  geminiCalls = [];
  [seeded] = await listBookings({ ids: [CONFIRMED] });
  // Dated the day of the event, as venues invoice.
  geminiText = JSON.stringify({ ...matchingInvoice({ ...seeded, billing_gstin: null }), invoice_date: seeded.event_date });
});
afterEach(async () => {
  await mutateDb((db) => {
    Object.assign(db.bookings.find((b) => b.id === CONFIRMED), { status: "CONFIRMED", itc_decision: null, itc_decided_by: null, itc_decided_at: null, itc_note: null });
  });
});

const invoiced = () =>
  mutateDb((db) => {
    db.bookings.find((b) => b.id === CONFIRMED).status = "COMPLETED";
  });
const asClient = (corporateRole) => signIn({ role: "CLIENT", userId: APPROVER, companyId: NIMBUS, corporateRole });
function upload({ bookingId = CONFIRMED, file = new File([PDF], "invoice.pdf", { type: "application/pdf" }) } = {}) {
  const form = new FormData();
  if (bookingId) form.set("bookingId", bookingId);
  if (file) form.set("file", file);
  return POST(new Request("https://lufer.test/api/finance/ocr-reconcile", { method: "POST", body: form }));
}
const stored = async () => (await listBookings({ ids: [CONFIRMED] }))[0];

test("route: signed out 401; organizers 403, before anything is sent to the model", async () => {
  signIn(null);
  assert.equal((await upload()).status, 401);
  asClient("ORGANIZER");
  assert.equal((await upload()).status, 403);
  assert.equal(geminiCalls.length, 0);
});

test("route: bad uploads are refused before the model is called", async () => {
  asClient("APPROVER");
  assert.equal((await upload({ file: null })).status, 400);
  assert.equal((await upload({ bookingId: "not-a-uuid" })).status, 400);
  assert.equal((await upload({ file: new File(["<html>"], "x.html", { type: "text/html" }) })).status, 415);
  assert.equal((await upload({ file: new File([new Uint8Array(MAX_INVOICE_BYTES + 1)], "big.pdf", { type: "application/pdf" }) })).status, 413);
  // Another company's booking.
  assert.equal((await upload({ bookingId: VERTEX_BOOKING })).status, 404);
  assert.equal(geminiCalls.length, 0);
});

test("route: a matching invoice is read by Gemini and verified, and ITC is left for the approver to decide", async () => {
  await invoiced();
  asClient("APPROVER");
  const res = await upload();
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.check.status, "verified");
  assert.deepEqual(body.check.findings, []);
  assert.equal(body.check.note, "Invoice INV/26/042 matched the booking (OCR check).");
  assert.equal(body.invoice.invoice_number, "INV/26/042");
  // Invoiced and undecided: still pending finance review.
  assert.equal(body.itcStatus, "review");
  const b = await stored();
  assert.equal(b.itc_decision, null);
  assert.equal(b.itc_note, null);

  // Gemini Flash got the PDF itself, inline, and was asked for JSON.
  assert.equal(geminiCalls.length, 1);
  const [call] = geminiCalls;
  assert.match(call.url, /\/models\/gemini-3\.8-flash:generateContent$/);
  const file = call.body.contents[0].parts.find((p) => p.inlineData);
  assert.equal(file.inlineData.mimeType, "application/pdf");
  assert.equal(Buffer.from(file.inlineData.data, "base64").toString(), "%PDF-1.7\n");
  assert.equal(call.body.generationConfig.responseMimeType, "application/json");
});

test("route: discrepancies are reported with their findings, and ITC still isn't decided", async () => {
  await invoiced();
  geminiText = JSON.stringify({ ...JSON.parse(geminiText), vendor_gstin: VENUE_KA, cgst: 9500, total_amount: seeded.invoice.invoice_total + 500 });
  asClient("APPROVER");
  const body = await (await upload()).json();
  assert.equal(body.check.status, "discrepancies");
  assert.deepEqual(body.check.findings.filter((f) => f.severity === "block").map((f) => f.code), ["VENDOR_GSTIN_MISMATCH", "CGST_MISMATCH", "TOTAL_MISMATCH"]);
  assert.match(body.check.note, /^Invoice INV\/26\/042: Issued by /);
  assert.equal(body.itcStatus, "review");
  assert.equal((await stored()).itc_decision, null);
});

test("route: an earlier ITC decision is reported and left as it was", async () => {
  await mutateDb((db) => {
    Object.assign(db.bookings.find((b) => b.id === CONFIRMED), { status: "COMPLETED", itc_decision: "blocked", itc_note: "Sec. 17(5): food and beverages" });
  });
  asClient("APPROVER");
  const body = await (await upload()).json();
  assert.equal(body.check.status, "verified");
  assert.equal(body.itcStatus, "blocked");
  const b = await stored();
  assert.equal(b.itc_decision, "blocked");
  assert.equal(b.itc_note, "Sec. 17(5): food and beverages");
});

test("route: finance viewers can check invoices too, before or after the event", async () => {
  asClient("FINANCE_VIEWER");
  const body = await (await upload()).json();
  assert.equal(body.check.status, "verified");
  assert.equal(body.itcStatus, "awaiting_invoice");
});

test("route: an answer that isn't an invoice is 422", async () => {
  asClient("APPROVER");
  geminiText = "Sorry, I can't read this document.";
  const res = await upload();
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /^Couldn't read an invoice in that file/);
});

test("route: with only a text-only provider configured (Groq), the reader is unavailable (503)", async () => {
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GROQ_API_KEY = "test-groq-key";
  asClient("APPROVER");
  const res = await upload();
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /reads documents/);
});
