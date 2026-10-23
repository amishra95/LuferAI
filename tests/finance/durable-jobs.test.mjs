// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// The durable finance jobs: the retry policy, the ERP export workflow
// (workflows/erp-export.ts) and the tax invoice workflow
// (workflows/tax-invoice.ts), run against the in-memory store and a local HTTP
// receiver. Outside the Workflow runtime "use step" is a no-op, so a step runs
// once per call: tests call steps directly to see each attempt's error, and the
// workflow to see what happens once the steps give up.
import { onWorkflowStart } from "../support/server-actions.mjs";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { backoffMs, isRetryableStatus, MAX_ATTEMPTS, MAX_RETRIES } from "../../lib/jobs/retry-policy.ts";
import { renderTaxInvoice } from "../../lib/finance/tax-invoice-document.ts";
import { PROVIDER_ENV } from "../../lib/finance/expense-adapters.ts";
import { booking as bookingFixture, VENUE_MH } from "./fixtures.mjs";

const { FatalError, RetryableError } = await import("workflow");
const { erpExportWorkflow, sendExport } = await import("../../workflows/erp-export.ts");
const { renderInvoice, taxInvoiceWorkflow } = await import("../../workflows/tax-invoice.ts");
const { exportBookingExpense } = await import("../../lib/finance/export-dispatcher.ts");
const { queueBookingExport } = await import("../../lib/finance/export-queue.ts");
const { queueTaxInvoice } = await import("../../lib/finance/tax-invoice-queue.ts");
const { saveCredential, readCredential } = await import("../../lib/auth/oauth-vault.ts");
const { findExpenseExport, getTaxInvoiceDocument } = await import("../../lib/data/index.ts");
const { mutateDb } = await import("../../lib/data/local-store.ts");

// Seed bookings (lib/data/mock-store.ts).
const CONFIRMED = "bbbbbbbb-0001-4000-8000-000000000001";
const COMPLETED = "bbbbbbbb-0002-4000-8000-000000000002";
const PENDING = "bbbbbbbb-0003-4000-8000-000000000003";
const APPROVER = "dddddddd-0002-4000-8000-000000000002";

const PROVIDER_VARS = Object.values(PROVIDER_ENV).flatMap((names) => Object.values(names).flat());
const OAUTH_VARS = ["OAUTH_VAULT_KEY", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_ACCOUNTS_URL", "ZOHO_REFRESH_TOKEN", "ERPNEXT_OAUTH_CLIENT_ID", "ERPNEXT_OAUTH_CLIENT_SECRET", "ERPNEXT_OAUTH_REFRESH_TOKEN", "ERPNEXT_OAUTH_TOKEN_URL"];
const clearEnv = () => {
  for (const k of [...PROVIDER_VARS, ...OAUTH_VARS]) delete process.env[k];
};

/** A local receiver: `respond(req)` decides each answer; every request is recorded. */
let server;
let base;
let requests = [];
let respond = () => ({ status: 200, body: {} });
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const entry = { method: req.method, path: req.url, headers: req.headers, body };
      requests.push(entry);
      const { status, body: out } = respond(entry);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

let audit = [];
beforeEach(async () => {
  clearEnv();
  requests = [];
  respond = () => ({ status: 200, body: {} });
  audit = [];
  mock.method(console, "info", (line) => {
    try {
      audit.push(JSON.parse(line));
    } catch {}
  });
  mock.method(console, "error", () => {});
  await mutateDb((db) => {
    db.expenseExports.splice(0);
    db.taxInvoiceDocuments.splice(0);
    db.oauthCredentials.splice(0);
  });
});
afterEach(() => {
  mock.restoreAll();
  onWorkflowStart(null);
  clearEnv();
});

const input = (provider, bookingId = CONFIRMED) => ({ bookingId, provider, requestedBy: APPROVER });
const exportRow = (bookingId, provider) => findExpenseExport(bookingId, "booking.confirmed", provider);

// ----------------------------------------------------------------------------
// Retry policy
// ----------------------------------------------------------------------------

test("retry policy: 5 attempts in all, backing off 30s, 1m, 2m, 4m (capped at 30m)", () => {
  assert.equal(MAX_ATTEMPTS, 5);
  assert.equal(MAX_RETRIES, 4);
  assert.deepEqual([1, 2, 3, 4].map(backoffMs), [30_000, 60_000, 120_000, 240_000]);
  assert.equal(backoffMs(20), 30 * 60_000);
  assert.equal(backoffMs(0), 30_000);
  assert.equal(backoffMs(Number.NaN), 30_000);
});

test("retry policy: retries timeouts, rate limits, server errors and 401; not other client errors", () => {
  for (const s of [401, 408, 425, 429, 500, 502, 503, 504]) assert.equal(isRetryableStatus(s), true, String(s));
  for (const s of [400, 403, 404, 409, 410, 413, 422]) assert.equal(isRetryableStatus(s), false, String(s));
});

test("both job steps allow 4 retries (5 attempts)", () => {
  assert.equal(sendExport.maxRetries, MAX_RETRIES);
  assert.equal(renderInvoice.maxRetries, MAX_RETRIES);
});

// ----------------------------------------------------------------------------
// ERP export
// ----------------------------------------------------------------------------

test("export step: a 503 is retryable with backoff, and each attempt is counted on the export row", async () => {
  process.env.RAMP_EXPENSE_URL = `${base}/ramp`;
  respond = () => ({ status: 503, body: {} });

  const startedAt = Date.now();
  const first = await sendExport(input("ramp")).catch((e) => e);
  assert.ok(RetryableError.is(first), String(first));
  assert.equal(first.message, "Receiver returned 503");
  const wait = first.retryAfter.getTime() - startedAt;
  assert.ok(wait >= 29_000 && wait <= 31_000, `retryAfter in ${wait}ms`);
  assert.deepEqual([(await exportRow(CONFIRMED, "ramp")).status, (await exportRow(CONFIRMED, "ramp")).attempts], ["failed", 1]);

  assert.ok(RetryableError.is(await sendExport(input("ramp")).catch((e) => e)));
  assert.equal((await exportRow(CONFIRMED, "ramp")).attempts, 2);
  assert.equal(requests.length, 2);
  // Retries are the same request, so the receiver can dedupe them.
  assert.equal(requests[0].headers["idempotency-key"], requests[1].headers["idempotency-key"]);
});

test("export step: a 400 is permanent (no retry)", async () => {
  process.env.BREX_EXPENSE_URL = `${base}/brex`;
  respond = () => ({ status: 400, body: {} });
  const err = await sendExport(input("brex")).catch((e) => e);
  assert.ok(FatalError.is(err), String(err));
  assert.equal(err.message, "Receiver returned 400");
});

test("export workflow: when the attempts give up, the export is dead-lettered in the audit trail; a manual export revives it", async () => {
  process.env.CONCUR_EXPENSE_URL = `${base}/concur`;
  respond = () => ({ status: 503, body: {} });

  const result = await erpExportWorkflow(input("concur"));
  assert.deepEqual(result, { bookingId: CONFIRMED, provider: "concur", status: "dead_lettered", error: "Receiver returned 503" });
  const row = await exportRow(CONFIRMED, "concur");
  assert.deepEqual([row.status, row.error, row.requested_by], ["dead_lettered", "Receiver returned 503", APPROVER]);
  const dead = audit.find((l) => l.audit === "expense_export" && l.status === "dead_lettered");
  assert.deepEqual([dead.booking_id, dead.provider, dead.recorded, dead.attempts], [CONFIRMED, "concur", true, 1]);

  respond = () => ({ status: 201, body: { id: "exp_1" } });
  assert.equal((await exportBookingExpense(CONFIRMED, { provider: "concur" })).status, "delivered");
  const revived = await exportRow(CONFIRMED, "concur");
  assert.deepEqual([revived.status, revived.attempts, revived.error], ["delivered", 2, null]);
});

test("export workflow: an unexportable booking stops at once and is dead-lettered without a row", async () => {
  const result = await erpExportWorkflow(input("zoho", PENDING));
  assert.equal(result.status, "dead_lettered");
  assert.match(result.error, /is PENDING, not confirmed/);
  assert.equal(await exportRow(PENDING, "zoho"), null);
  assert.equal(audit.find((l) => l.status === "dead_lettered").recorded, false);
});

test("export workflow: with no endpoint configured the export is recorded as mocked", async () => {
  assert.deepEqual(await erpExportWorkflow(input("erpnext")), { bookingId: CONFIRMED, provider: "erpnext", status: "mocked" });
  assert.equal((await exportRow(CONFIRMED, "erpnext")).status, "mocked");
  assert.deepEqual(await erpExportWorkflow(input("erpnext")), { bookingId: CONFIRMED, provider: "erpnext", status: "skipped" });
});

test("Zoho export: a vault token about to expire is refreshed first, and the export uses the new one", async () => {
  Object.assign(process.env, {
    OAUTH_VAULT_KEY: randomBytes(32).toString("base64"),
    ZOHO_CLIENT_ID: "1000.CLIENT",
    ZOHO_CLIENT_SECRET: "zoho-secret",
    ZOHO_ACCOUNTS_URL: `${base}/accounts`,
    ZOHO_EXPENSE_URL: `${base}/zoho/expenses`,
    ZOHO_EXPENSE_AUTH_TOKEN: "1000.stale-env-token",
  });
  await saveCredential({ provider: "zoho", accessToken: "1000.old", refreshToken: "1000.refresh", expiresAt: new Date(Date.now() + 3 * 60_000).toISOString(), organizationId: "60001234" }, null);
  respond = (req) => (req.path === "/accounts/oauth/v2/token" ? { status: 200, body: { access_token: "1000.rotated", expires_in: 3600 } } : { status: 201, body: {} });

  assert.deepEqual(await erpExportWorkflow(input("zoho", COMPLETED)), { bookingId: COMPLETED, provider: "zoho", status: "delivered" });
  assert.deepEqual(requests.map((r) => r.path), ["/accounts/oauth/v2/token", "/zoho/expenses"]);
  assert.equal(requests[1].headers.authorization, "Zoho-oauthtoken 1000.rotated");
  assert.equal(requests[1].headers["x-com-zoho-expense-organizationid"], "60001234");
  assert.equal((await readCredential("zoho")).accessToken, "1000.rotated");
});

test("ERPNext export: an OAuth token in the vault is sent as Bearer instead of the API key", async () => {
  Object.assign(process.env, { OAUTH_VAULT_KEY: randomBytes(32).toString("base64"), ERPNEXT_URL: `${base}/api/resource/Purchase Invoice`, ERPNEXT_API_KEY: "k", ERPNEXT_API_SECRET: "s" });
  await saveCredential({ provider: "erpnext", accessToken: "erp-oauth", refreshToken: null, expiresAt: new Date(Date.now() + 3600_000).toISOString(), organizationId: null }, null);
  assert.equal((await erpExportWorkflow(input("erpnext", COMPLETED))).status, "delivered");
  assert.equal(requests[0].path, "/api/resource/Purchase%20Invoice");
  assert.equal(requests[0].headers.authorization, "Bearer erp-oauth");
});

test("queueBookingExport: starts the workflow when the runtime is up; otherwise exports inline once", async () => {
  const starts = [];
  onWorkflowStart(async (wf, args) => (starts.push({ wf, args }), { runId: "wrun_9" }));
  assert.deepEqual(await queueBookingExport(input("webhook")), { queued: true, runId: "wrun_9" });
  assert.equal(starts[0].wf, erpExportWorkflow);
  assert.deepEqual(starts[0].args, [input("webhook")]);
  assert.equal(await exportRow(CONFIRMED, "webhook"), null);

  onWorkflowStart(null);
  assert.deepEqual(await queueBookingExport(input("webhook")), { queued: false, outcome: { status: "mocked", provider: "webhook" } });
  assert.equal((await exportRow(CONFIRMED, "webhook")).requested_by, APPROVER);
});

// ----------------------------------------------------------------------------
// Tax invoice
// ----------------------------------------------------------------------------

const subject = (b) => ({ bookingId: b.id, eventDate: b.event_date, partySize: b.party_size, supplierName: b.venue.name, supplierCity: b.venue.city, recipientName: b.company.legal_name, invoice: b.invoice });

test("tax invoice document: deterministic HTML with its SHA-256; intra-state shows CGST + SGST", () => {
  const doc = renderTaxInvoice(subject(bookingFixture()));
  assert.deepEqual(renderTaxInvoice(subject(bookingFixture())), doc);
  assert.match(doc.sha256, /^[0-9a-f]{64}$/);
  assert.match(doc.html, /^<!doctype html>/);
  assert.match(doc.html, /CGST @ 9%/);
  assert.match(doc.html, /SGST @ 9%/);
  assert.doesNotMatch(doc.html, /IGST/);
  assert.match(doc.html, /998596/);
  assert.match(doc.html, /₹1,18,000\.00/);
  assert.match(doc.html, /Invoice no\. not yet numbered/);
  assert.equal(doc.invoiceNumber, null);
});

test("tax invoice document: inter-state shows IGST; a number, when issued, is shown; every value is escaped", () => {
  const b = bookingFixture({ venueGstin: VENUE_MH });
  const doc = renderTaxInvoice({ ...subject(b), supplierName: `<script>alert("x")</script> & Co`, invoice: { ...b.invoice, invoice_number: "INV/2026-27/0042" } });
  assert.match(doc.html, /IGST @ 18%/);
  assert.doesNotMatch(doc.html, /CGST/);
  assert.match(doc.html, /Invoice no\. INV\/2026-27\/0042/);
  assert.equal(doc.invoiceNumber, "INV/2026-27/0042");
  assert.ok(!doc.html.includes("<script>"));
  assert.match(doc.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; Co/);
});

test("tax invoice workflow: renders and stores the document once; re-running is a no-op", async () => {
  const first = await taxInvoiceWorkflow(COMPLETED);
  assert.equal(first.status, "rendered");
  const stored = await getTaxInvoiceDocument(COMPLETED);
  assert.deepEqual([stored.status, stored.attempts, stored.error, stored.html_sha256], ["rendered", 1, null, first.sha256]);
  assert.match(stored.html, /Tax Invoice/);
  assert.ok(stored.rendered_at);

  assert.deepEqual(await taxInvoiceWorkflow(COMPLETED), { bookingId: COMPLETED, status: "unchanged", sha256: first.sha256 });
  assert.equal((await getTaxInvoiceDocument(COMPLETED)).attempts, 1);
});

test("tax invoice workflow: an unconfirmed booking fails permanently and is dead-lettered with its error", async () => {
  const err = await renderInvoice(PENDING).catch((e) => e);
  assert.ok(FatalError.is(err), String(err));

  const result = await taxInvoiceWorkflow(PENDING);
  assert.equal(result.status, "dead_lettered");
  const row = await getTaxInvoiceDocument(PENDING);
  assert.equal(row.status, "dead_lettered");
  assert.match(row.error, /is PENDING, not confirmed/);
  assert.equal(row.html, null);
  assert.equal(row.attempts, 2, "two render attempts (the direct step call and the workflow's); dead-lettering isn't one");
  assert.ok(audit.some((l) => l.audit === "tax_invoice" && l.status === "dead_lettered" && l.booking_id === PENDING));
});

test("queueTaxInvoice: starts the workflow when the runtime is up; otherwise renders inline", async () => {
  const starts = [];
  onWorkflowStart(async (wf, args) => (starts.push({ wf, args }), { runId: "wrun_inv" }));
  await queueTaxInvoice(CONFIRMED);
  assert.deepEqual(starts.map((s) => [s.wf, s.args]), [[taxInvoiceWorkflow, [CONFIRMED]]]);
  assert.equal(await getTaxInvoiceDocument(CONFIRMED), null);

  onWorkflowStart(null);
  await queueTaxInvoice(CONFIRMED);
  assert.equal((await getTaxInvoiceDocument(CONFIRMED)).status, "rendered");
});
