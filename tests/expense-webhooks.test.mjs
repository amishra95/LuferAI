// Card-transaction reconciliation webhooks (lib/expense/webhook-dispatcher.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import {
  buildCardPayload,
  deliverCardTransaction,
  ERP_SCHEMA,
  isCardSyncProvider,
  signPayload,
  verifySignature,
} from "../lib/expense/webhook-dispatcher.ts";

const txn = {
  event: "card.settled",
  transactionId: "3f1c0a52-0000-4000-8000-000000000001:card.settled",
  cardId: "vc_sandbox_0123456789abcdef0123456789abcdef",
  bookingId: "b0000000-0000-4000-8000-000000000002",
  amountInr: 48231.5,
  currency: "INR",
  merchant: "The Leela Palace",
  category: "Corporate events",
  memo: "Corporate event · The Leela Palace · 2026-11-14 · 40 guests · ENG-42",
  userId: "u0000000-0000-4000-8000-000000000003",
  approvalId: "a0000000-0000-4000-8000-000000000004",
  approvedAt: "2026-10-20T09:15:00.000Z",
  receiptUrl: "https://lufer-ai.vercel.app/api/exports/e0000000-0000-4000-8000-000000000005",
  invoiceUrl: "https://lufer-ai.vercel.app/api/exports/e0000000-0000-4000-8000-000000000005",
  occurredAt: "2026-11-14T21:40:00.000Z",
};

test("Ramp payload: cents, merchant, category, receipt, approval and card", () => {
  const body = buildCardPayload("ramp", txn);
  assert.equal(body.amount_in_cents, 4823150);
  assert.equal(body.merchant_name, "The Leela Palace");
  assert.equal(body.category, "Corporate events");
  assert.equal(body.receipt_url, txn.receiptUrl);
  assert.equal(body.approval_id, txn.approvalId);
  assert.match(body.card_id, /^vc_sandbox_/);
  assert.equal(body.external_id, txn.transactionId);
});

test("Brex payload: minor-unit amount, currency, descriptor, user, memo, card", () => {
  const body = buildCardPayload("brex", txn);
  assert.deepEqual(
    { amount: body.amount, currency: body.currency, merchant_descriptor: body.merchant_descriptor, user_id: body.user_id, memo: body.memo, card_id: body.card_id },
    { amount: 4823150, currency: "INR", merchant_descriptor: "The Leela Palace", user_id: txn.userId, memo: txn.memo, card_id: txn.cardId }
  );
  assert.equal(Number.isInteger(body.amount), true);
});

test("Concur, Zoho and the plain webhook share the ISO ERP payload", () => {
  for (const p of ["concur", "zoho", "webhook"]) {
    const body = buildCardPayload(p, txn);
    assert.equal(body.schema, ERP_SCHEMA);
    assert.equal(body.transaction_id, txn.transactionId);
    assert.equal(body.amount, 48231.5);
    assert.match(body.currency, /^[A-Z]{3}$/); // ISO 4217
    assert.equal(body.merchant, "The Leela Palace");
    assert.equal(body.invoice_url, txn.invoiceUrl);
    assert.ok(!Number.isNaN(Date.parse(body.manager_approval_timestamp))); // ISO 8601
  }
  // No approval chain: the field is present and null, not missing.
  assert.equal(buildCardPayload("concur", { ...txn, approvalId: null, approvedAt: null }).manager_approval_timestamp, null);
  // Rupee amounts round to paise without float drift.
  assert.equal(buildCardPayload("ramp", { ...txn, amountInr: 0.29 }).amount_in_cents, 29);
});

test("providers and env names", () => {
  assert.ok(["ramp", "brex", "concur", "zoho", "webhook"].every(isCardSyncProvider));
  assert.equal(isCardSyncProvider("quickbooks"), false);
  assert.equal(isCardSyncProvider(undefined), false);
});

test("HMAC-SHA256 signatures verify, and tampering or a wrong secret fails", () => {
  const body = JSON.stringify({ event: "card.settled", card_id: txn.cardId, amount_inr: 100 });
  const secret = "test-secret-not-real";
  const header = signPayload(body, secret);
  assert.equal(header, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  assert.equal(verifySignature(body, header, secret), true);
  assert.equal(verifySignature(body.replace("100", "1000"), header, secret), false);
  assert.equal(verifySignature(body, header, "other-secret"), false);
  assert.equal(verifySignature(body, header.slice(0, -2), secret), false);
  assert.equal(verifySignature(body, header.replace("sha256=", ""), secret), false);
  assert.equal(verifySignature(body, null, secret), false);
  // Unconfigured secret: nothing verifies, even an "empty-key" signature.
  assert.equal(verifySignature(body, signPayload(body, ""), ""), false);
});

/** A fetch stub that answers with the given statuses (or throws for "error"). */
function stubFetch(statuses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (s === "error") throw new Error("connect ECONNREFUSED");
    return new Response(null, { status: s });
  };
  return { fetch, calls };
}
const noSleep = async () => {};

test("delivery: signed, authenticated, idempotent request", async () => {
  const { fetch, calls } = stubFetch([200]);
  const out = await deliverCardTransaction({ provider: "ramp", url: "https://erp.example/hook", headers: { Authorization: "Bearer tok" }, signingSecret: "s3cret" }, txn, { fetch, sleep: noSleep });
  assert.equal(out.status, "delivered");
  assert.equal(out.attempts, 1);
  const { init } = calls[0];
  assert.equal(init.headers["Idempotency-Key"], txn.transactionId);
  assert.equal(init.headers.Authorization, "Bearer tok");
  assert.equal(init.headers["X-Lufer-Event"], "card.settled");
  assert.equal(verifySignature(init.body, init.headers["X-Lufer-Signature"], "s3cret"), true);
  assert.equal(init.headers["X-Lufer-Payload-SHA256"], createHash("sha256").update(init.body).digest("hex"));
  assert.equal(out.payloadSha256, init.headers["X-Lufer-Payload-SHA256"]);
});

test("delivery: no URL is mocked and sends nothing", async () => {
  const { fetch, calls } = stubFetch([200]);
  const out = await deliverCardTransaction({ provider: "brex", url: "" }, txn, { fetch, sleep: noSleep });
  assert.equal(out.status, "mocked");
  assert.equal(calls.length, 0);
});

test("delivery: retries 5xx, 429 and network errors, then succeeds", async () => {
  const { fetch, calls } = stubFetch([503, 429, "error", 200]);
  const waits = [];
  const out = await deliverCardTransaction({ provider: "concur", url: "https://erp.example/hook" }, txn, { fetch, sleep: async (ms) => void waits.push(ms), attempts: 4 });
  assert.equal(out.status, "delivered");
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
  // Every retry carries the same body and idempotency key.
  assert.equal(new Set(calls.map((c) => c.init.body)).size, 1);
});

test("delivery failures: 4xx stops at once, exhausted retries report the last error, never throws", async () => {
  const bad = stubFetch([400]);
  const out400 = await deliverCardTransaction({ provider: "zoho", url: "https://erp.example/hook" }, txn, { fetch: bad.fetch, sleep: noSleep });
  assert.deepEqual([out400.status, out400.attempts, out400.responseCode, bad.calls.length], ["failed", 1, 400, 1]);

  const down = stubFetch([500]);
  const out500 = await deliverCardTransaction({ provider: "webhook", url: "https://erp.example/hook" }, txn, { fetch: down.fetch, sleep: noSleep, attempts: 3 });
  assert.deepEqual([out500.status, out500.attempts, out500.error], ["failed", 3, "Receiver returned 500"]);

  const offline = stubFetch(["error"]);
  const outNet = await deliverCardTransaction({ provider: "ramp", url: "https://erp.example/hook" }, txn, { fetch: offline.fetch, sleep: noSleep, attempts: 2 });
  assert.deepEqual([outNet.status, outNet.attempts, outNet.error, outNet.responseCode], ["failed", 2, "connect ECONNREFUSED", undefined]);
});
