// Run with: npm test
//
// Payment rules (lib/payments/rules.ts): Razorpay signatures, refund limits and
// the invoice balance; and migration 20261118000000 in Postgres (PGlite):
// one live deposit and one live balance payment per booking, the refunded
// total, refund voucher serials.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { afterRefund, afterRefundFailed, invoiceOutstanding, refundable, refundRefusal, suggestedRefund, validCheckoutSignature, validWebhookSignature } from "../lib/payments/rules.ts";
import { CancelInput } from "../lib/bookings/cancellation.ts";
import { createDatabase } from "./support/supabase-pglite.mjs";

const hmac = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");

test("checkout signature: HMAC of order|payment with the key secret", () => {
  const sig = hmac("key_secret", "order_A|pay_B");
  assert.equal(validCheckoutSignature("order_A", "pay_B", sig, "key_secret"), true);
  assert.equal(validCheckoutSignature("order_X", "pay_B", sig, "key_secret"), false, "another order");
  assert.equal(validCheckoutSignature("order_A", "pay_X", sig, "key_secret"), false, "another payment");
  assert.equal(validCheckoutSignature("order_A", "pay_B", sig, "other_secret"), false);
  assert.equal(validCheckoutSignature("order_A", "pay_B", "", "key_secret"), false);
  assert.equal(validCheckoutSignature("order_A", "pay_B", sig.slice(0, 10), "key_secret"), false);
  assert.equal(validCheckoutSignature("order_A", "pay_B", sig, ""), false, "no secret never verifies");
});

test("webhook signature: HMAC of the raw body with the webhook secret", () => {
  const body = '{"event":"payment.captured"}';
  assert.equal(validWebhookSignature(body, hmac("whsec", body), "whsec"), true);
  assert.equal(validWebhookSignature(body + " ", hmac("whsec", body), "whsec"), false, "any byte changed");
  assert.equal(validWebhookSignature(body, hmac("key_secret", body), "whsec"), false);
  assert.equal(validWebhookSignature(body, "", "whsec"), false);
});

test("refunds: only captured money, never more than is left, to the paisa", () => {
  const paid = { status: "captured", amount_inr: 29500, refunded_inr: 0 };
  assert.equal(refundable(paid), 29500);
  assert.equal(refundable({ ...paid, refunded_inr: 10000.5 }), 19499.5);
  assert.equal(refundable({ ...paid, status: "authorized" }), 0);
  assert.equal(refundRefusal(paid, 29500), null);
  assert.equal(refundRefusal(paid, 0.01), null);
  assert.match(refundRefusal(paid, 29500.01), /At most ₹29,500\.00/);
  assert.match(refundRefusal({ ...paid, refunded_inr: 20000 }, 9500.01), /At most ₹9,500\.00/);
  assert.match(refundRefusal(paid, 0), /above zero/);
  assert.match(refundRefusal(paid, -5), /above zero/);
  assert.match(refundRefusal(paid, 10.001), /two decimal places/);
  assert.match(refundRefusal({ ...paid, status: "authorized" }, 100), /Only a captured payment/);
  assert.match(refundRefusal({ ...paid, status: "refunded", refunded_inr: 29500 }, 100), /already refunded in full/);
  assert.match(refundRefusal(null, 100), /no captured payment/);
});

test("refunds: a part refund stays captured, the last rupee makes it refunded, a failed one is given back", () => {
  const paid = { amount_inr: 29500, refunded_inr: 0 };
  assert.deepEqual(afterRefund(paid, 14750), { refunded_inr: 14750, status: "captured" });
  assert.deepEqual(afterRefund({ ...paid, refunded_inr: 14750 }, 14750), { refunded_inr: 29500, status: "refunded" });
  assert.deepEqual(afterRefund(paid, 0.1 + 0.2), { refunded_inr: 0.3, status: "captured" }, "no float dust");
  assert.deepEqual(afterRefundFailed({ ...paid, refunded_inr: 29500 }, 14750), { refunded_inr: 14750, status: "captured" });
  assert.deepEqual(afterRefundFailed(paid, 500), { refunded_inr: 0, status: "captured" });
});

test("suggested refund: the venue's refund share of the deposit paid, capped at what's left", () => {
  const paid = { status: "captured", amount_inr: 29500, refunded_inr: 0 };
  assert.equal(suggestedRefund(100, paid), 29500);
  assert.equal(suggestedRefund(50, paid), 14750);
  assert.equal(suggestedRefund(0, paid), 0);
  assert.equal(suggestedRefund(100, { ...paid, refunded_inr: 20000 }), 9500);
  assert.equal(suggestedRefund(100, null), 0);
  assert.equal(suggestedRefund(100, { ...paid, status: "authorized" }), 0);
});

test("invoice balance: total less the advance less what was paid since, never below zero", () => {
  assert.equal(invoiceOutstanding(118000, 29500, 0), 88500);
  assert.equal(invoiceOutstanding(118000, 29500, 88500), 0);
  assert.equal(invoiceOutstanding(118000, 0, 0), 118000);
  assert.equal(invoiceOutstanding(100, 60.1, 39.9), 0);
  assert.equal(invoiceOutstanding(100, 150, 0), 0);
});

test("cancel input: a refund amount is optional and can't be negative", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(CancelInput.parse({ bookingId: id }).refundInr, undefined);
  assert.equal(CancelInput.parse({ bookingId: id, refundInr: 14750 }).refundInr, 14750);
  assert.equal(CancelInput.safeParse({ bookingId: id, refundInr: -1 }).success, false);
});

// --- Postgres ---------------------------------------------------------------------------------

let db;
let booking;
before(async () => {
  db = await createDatabase();
  booking = (await db.query(`select id, venue_id, company_id from public.bookings order by id limit 1`)).rows[0];
});

const pay = (purpose, status, extra = "") =>
  db.query(
    `insert into payments (booking_id, purpose, provider, status, amount_inr, deposit_rate, provider_order_id, invoice${extra ? ", refunded_inr" : ""})
     values ($1, $2, 'razorpay', $3, 29500, 0.25, gen_random_uuid()::text, '{}'${extra ? `, ${extra}` : ""}) returning id`,
    [booking.id, purpose, status]
  );

test("db: one live deposit and one live balance payment per booking, side by side", async () => {
  await db.query("begin");
  try {
    await pay("deposit", "captured");
    await pay("balance", "authorized"); // the balance doesn't collide with the captured deposit
    await db.query("savepoint s");
    await assert.rejects(pay("deposit", "authorized"), /payments_one_live_per_booking/);
    await db.query("rollback to savepoint s");
    await assert.rejects(pay("balance", "captured"), /payments_one_live_balance_per_booking/);
    await db.query("rollback to savepoint s");
    await pay("balance", "failed"); // a failed attempt doesn't block a retry
    await assert.rejects(pay("tip", "created"), /payments_purpose_check/);
  } finally {
    await db.query("rollback");
  }
});

test("db: a payment can't be refunded for more than it took", async () => {
  await db.query("begin");
  try {
    await pay("deposit", "captured", "29500");
    await db.query("savepoint s");
    await assert.rejects(pay("balance", "captured", "29500.01"), /payments_refunded_check/);
    await db.query("rollback to savepoint s");
    await assert.rejects(pay("balance", "captured", "-1"), /payments_refunded_check/);
  } finally {
    await db.query("rollback");
  }
});

test("db: existing payments keep their meaning (instalment, order) and new ones default to deposit", async () => {
  const { rows } = await db.query(`select column_default from information_schema.columns where table_name = 'payments' and column_name = 'purpose'`);
  assert.match(rows[0].column_default, /deposit/);
  const wrong = await db.query(`select count(*)::int n from payments where (booking_invoice_id is not null and purpose <> 'instalment') or (catalog_order_id is not null and purpose <> 'order')`);
  assert.equal(wrong.rows[0].n, 0);
});

test("db: refund vouchers have their own consecutive series per venue per FY, service role only", async () => {
  const take = async (on) => (await db.query(`select public.take_refund_voucher_number($1, $2) n`, [booking.venue_id, on])).rows[0].n;
  assert.equal(await take("2026-11-12"), "RFV/2026-27/000001");
  assert.equal(await take("2027-03-31"), "RFV/2026-27/000002");
  assert.equal(await take("2027-04-01"), "RFV/2027-28/000001");
  const { rows } = await db.query(`select has_function_privilege('authenticated', 'public.take_refund_voucher_number(uuid, date)', 'execute') ok`);
  assert.equal(rows[0].ok, false);
});

test("db: refunds and refund vouchers are closed to companies' writes; a refund is recorded once per provider reference", async () => {
  await db.query("begin");
  try {
    const p = (await pay("deposit", "captured")).rows[0];
    await db.query(`insert into payment_refunds (payment_id, provider_refund_id, amount_inr, status) values ($1, 'rfnd_1', 100, 'processed')`, [p.id]);
    await db.query("savepoint s");
    await assert.rejects(db.query(`insert into payment_refunds (payment_id, provider_refund_id, amount_inr, status) values ($1, 'rfnd_1', 100, 'processed')`, [p.id]), /payment_refunds_provider_key/);
    await db.query("rollback to savepoint s");
    await assert.rejects(db.query(`insert into payment_refunds (payment_id, amount_inr) values ($1, 0)`, [p.id]), /amount_inr/);
    await db.query("rollback to savepoint s");
    const rls = await db.query(`select relname, relrowsecurity from pg_class where relname in ('payment_refunds', 'refund_vouchers', 'refund_voucher_series') order by relname`);
    assert.deepEqual(rls.rows.map((r) => r.relrowsecurity), [true, true, true]);
    const writes = await db.query(`select count(*)::int n from pg_policies where tablename in ('payment_refunds', 'refund_vouchers', 'refund_voucher_series') and cmd <> 'SELECT'`);
    assert.equal(writes.rows[0].n, 0, "no write policies: the service role only");
  } finally {
    await db.query("rollback");
  }
});
