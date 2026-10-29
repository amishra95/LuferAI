// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// WhatsApp approvals end to end: the webhook route (app/api/webhooks/whatsapp)
// receiving Meta and Twilio button presses, the approval state moving through
// lib/data's decideApproval on the in-memory store, and the follow-ups (the
// approver's confirmation, live events, the next step's request). Outbound
// Graph / Twilio calls are captured by a stubbed fetch.
import { signIn } from "../support/server-actions.mjs";
import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { approvalButtonId } from "../../lib/approvals/whatsapp-buttons.ts";

const { POST } = await import("../../app/api/webhooks/whatsapp/route.ts");
const { notifyApprovers } = await import("../../lib/approvals/whatsapp.ts");
const { channelStore } = await import("../../lib/channels/store.ts");
const { listApprovals, listBookings } = await import("../../lib/data/index.ts");
const { mutateDb } = await import("../../lib/data/local-store.ts");
const { appEventLog } = await import("../../lib/telemetry/live.ts");
const { approveEventSpend } = await import("../../app/(dashboard)/client/actions.ts");

// Seed data (lib/data/mock-store.ts): Nimbus's chain is Arjun (tier 1) then Vikram (tier 2).
const NIMBUS = "11111111-1111-4111-8111-111111111111";
const BOOKING = "bbbbbbbb-0003-4000-8000-000000000003";
const PRIYA = "dddddddd-0001-4000-8000-000000000001"; // organizer, the requester
const ARJUN = "dddddddd-0002-4000-8000-000000000002";
const VIKRAM = "dddddddd-0005-4000-8000-000000000005";
const STEP1 = "aaaaaaaa-0001-4000-8000-000000000001";
const STEP2 = "aaaaaaaa-0002-4000-8000-000000000002";
const ARJUN_WA = "919845000002";
const VIKRAM_WA = "919845000005";

const SECRET = "test-approval-secret";
const APP_SECRET = "test-meta-app-secret";
const TWILIO_TOKEN = "test-twilio-token";
const URL_ = "https://lufer.test/api/webhooks/whatsapp";
const ENV = {
  WHATSAPP_VERIFY_TOKEN: "verify",
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_ACCESS_TOKEN: "meta-token",
  WHATSAPP_PHONE_NUMBER_ID: "1000",
  WHATSAPP_APPROVAL_SECRET: SECRET,
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: TWILIO_TOKEN,
  TWILIO_WHATSAPP_FROM: "+14155238886",
};
const OPTIONAL_ENV = ["WHATSAPP_APPROVAL_TEMPLATE", "WHATSAPP_APPROVAL_TEMPLATE_LANG", "TWILIO_APPROVAL_CONTENT_SID", "TWILIO_WEBHOOK_URL"];

// ---------------------------------------------------------------------------
// Outbound capture: every Graph / Twilio send is recorded and answered 200.
// ---------------------------------------------------------------------------

let sent = [];
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://graph.facebook.com/")) {
      sent.push({ provider: "meta", url, body: JSON.parse(init.body) });
      return Response.json({ messages: [{ id: "wamid.out" }] });
    }
    if (url.startsWith("https://api.twilio.com/")) {
      sent.push({ provider: "twilio", url, body: Object.fromEntries(new URLSearchParams(String(init.body))) });
      return Response.json({ sid: "SMout" });
    }
    return realFetch(input, init);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  for (const k of [...Object.keys(ENV), ...OPTIONAL_ENV]) delete process.env[k];
  signIn(null);
});

/** Waits for the follow-ups the route schedules after its response. */
async function waitFor(check, what) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for ${what}; sent: ${JSON.stringify(sent.map((s) => s.body))}`);
}
const textsTo = (to) => sent.filter((s) => (s.provider === "meta" ? s.body.to === to && s.body.type === "text" : s.body.To === `whatsapp:+${to}` && s.body.Body)).map((s) => s.body.text?.body ?? s.body.Body);
const buttonsTo = (to) => sent.filter((s) => s.provider === "meta" && s.body.to === to && s.body.type !== "text");

// ---------------------------------------------------------------------------
// Fixtures: the seed booking waiting on two sequential steps, fresh per test.
// ---------------------------------------------------------------------------

let seq = 0;
beforeEach(async () => {
  Object.assign(process.env, ENV);
  for (const k of OPTIONAL_ENV) delete process.env[k];
  sent = [];
  const now = new Date().toISOString();
  const approval = (id, approver, step, activated) => ({
    id,
    tenant_id: NIMBUS,
    booking_id: BOOKING,
    catalog_order_id: null,
    requested_by: PRIYA,
    approver_id: approver,
    reason: "Over the per-head limit",
    status: "PENDING",
    decision_note: null,
    decided_at: null,
    step,
    activated_at: activated ? now : null,
    due_at: null,
    escalated_from: null,
    rule_id: null,
    created_at: now,
    updated_at: now,
  });
  await mutateDb((db) => {
    db.approvals = db.approvals.filter((a) => a.booking_id !== BOOKING);
    db.approvals.push(approval(STEP1, ARJUN, 1, true), approval(STEP2, VIKRAM, 2, false));
    Object.assign(db.bookings.find((b) => b.id === BOOKING), { status: "PENDING_APPROVAL" });
    for (const u of db.users) if (u.user_id === ARJUN || u.user_id === VIKRAM) u.corporate_role = "APPROVER";
  });
  const store = channelStore();
  await store.setEnabled("whatsapp", true);
  for (const l of await store.listLinks("whatsapp")) await store.removeLink("whatsapp", l.senderId);
  await store.upsertLink({ channel: "whatsapp", senderId: ARJUN_WA, userId: ARJUN, companyId: NIMBUS, userName: "Arjun Mehta" });
  await store.upsertLink({ channel: "whatsapp", senderId: VIKRAM_WA, userId: VIKRAM, companyId: NIMBUS, userName: "Vikram Shah" });
});
afterEach(() => signIn(null));

const approvalById = async (id) => (await listApprovals({ tenantId: NIMBUS })).find((a) => a.id === id);
const bookingStatus = async () => (await listBookings({ companyId: NIMBUS, ids: [BOOKING] }))[0].status;
const button = (approvalId, decision, approver) => approvalButtonId(approvalId, decision, approver, SECRET);

/** A Meta webhook delivering one button press, signed with the app secret (or `signature`). */
function metaPress({ from, buttonId, id = `wamid.in.${++seq}`, template = false, signature }) {
  const message = template
    ? { id, from, type: "button", button: { payload: buttonId, text: "Approve" } }
    : { id, from, type: "interactive", interactive: { type: "button_reply", button_reply: { id: buttonId, title: "Approve" } } };
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [message] } }] }] });
  const sig = signature ?? `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
  return POST(new Request(URL_, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw }));
}

/** A Twilio callback for one button press, signed with the auth token (or `signature`). */
function twilioPress({ from, buttonId, sid = `SMin${++seq}`, signature }) {
  const params = new URLSearchParams({ MessageSid: sid, From: `whatsapp:+${from}`, To: "whatsapp:+14155238886", ButtonPayload: buttonId, ButtonText: "Approve" });
  const signed = URL_ + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
  const sig = signature ?? createHmac("sha1", TWILIO_TOKEN).update(signed).digest("base64");
  return POST(new Request(URL_, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: params.toString() }));
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

test("a Meta press with a bad signature is refused with 401 and decides nothing", async () => {
  const res = await metaPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN), signature: "sha256=00" });
  assert.equal(res.status, 401);
  assert.equal((await approvalById(STEP1)).status, "PENDING");
  assert.equal(sent.length, 0);
});

test("a Twilio press with a bad signature is refused with 401 and decides nothing", async () => {
  const res = await twilioPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN), signature: "bm9wZQ==" });
  assert.equal(res.status, 401);
  assert.equal((await approvalById(STEP1)).status, "PENDING");
});

test("Twilio presses are refused with 503 while Twilio isn't configured", async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  const res = await twilioPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN), signature: "x" });
  assert.equal(res.status, 503);
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

test("tier 1 approves: the step is approved, step 2 opens and its approver gets the buttons", async () => {
  const res = await metaPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN) });
  assert.equal(res.status, 200);

  const step1 = await approvalById(STEP1);
  assert.equal(step1.status, "APPROVED");
  assert.equal(step1.decision_note, "Decided on WhatsApp");
  assert.ok((await approvalById(STEP2)).activated_at, "step 2 is now active");
  assert.equal(await bookingStatus(), "PENDING_APPROVAL");

  await waitFor(() => textsTo(ARJUN_WA).length === 1 && buttonsTo(VIKRAM_WA).length === 1, "confirmation and next request");
  assert.equal(textsTo(ARJUN_WA)[0], `Approved: ${step1.booking.venue_name}. It now goes to the next approver.`);

  // The next approver's buttons are bound to them and to step 2.
  const msg = buttonsTo(VIKRAM_WA)[0].body;
  assert.equal(msg.type, "interactive");
  assert.match(msg.interactive.body.text, /^Approval needed \(tier 2\): Priya Raman/);
  assert.deepEqual(
    msg.interactive.action.buttons.map((b) => [b.reply.title, b.reply.id]),
    [
      ["Approve", button(STEP2, "APPROVED", VIKRAM)],
      ["Reject", button(STEP2, "REJECTED", VIKRAM)],
    ]
  );
  // Arjun, whose step it was, isn't sent it again.
  assert.equal(buttonsTo(ARJUN_WA).length, 0);
});

test("the last tier approves: the booking moves to the venue and live events are published", async () => {
  await metaPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN) });
  const cursor = await appEventLog().head();
  const res = await metaPress({ from: VIKRAM_WA, buttonId: button(STEP2, "APPROVED", VIKRAM), template: true });
  assert.equal(res.status, 200);
  assert.equal((await approvalById(STEP2)).status, "APPROVED");
  assert.equal(await bookingStatus(), "PENDING");

  await waitFor(() => textsTo(VIKRAM_WA).some((t) => t.endsWith("It's on its way to the venue.")), "confirmation");
  // The event log batches appends for a moment before they're readable.
  let events = [];
  const published = () =>
    events.some((e) => e.type === "approval" && e.approvalId === STEP2 && e.decision === "APPROVED") &&
    events.some((e) => e.type === "booking" && e.bookingId === BOOKING && e.status === "PENDING" && e.by === "approval");
  for (let i = 0; i < 100 && !published(); i++) {
    await new Promise((r) => setTimeout(r, 10));
    ({ events } = await appEventLog().since(cursor));
  }
  assert.ok(published(), `approval and booking events; got ${JSON.stringify(events.map((e) => e.type))}`);
});

test("a rejection cancels the booking and nobody else is asked", async () => {
  const res = await metaPress({ from: ARJUN_WA, buttonId: button(STEP1, "REJECTED", ARJUN) });
  assert.equal(res.status, 200);
  assert.equal((await approvalById(STEP1)).status, "REJECTED");
  assert.equal(await bookingStatus(), "CANCELLED");
  await waitFor(() => textsTo(ARJUN_WA).length === 1, "confirmation");
  assert.match(textsTo(ARJUN_WA)[0], /^Rejected: .*The request is cancelled/);
  assert.equal(buttonsTo(VIKRAM_WA).length, 0);
});

test("tier 2 can't decide before tier 1: refused, and told why", async () => {
  const res = await metaPress({ from: VIKRAM_WA, buttonId: button(STEP2, "APPROVED", VIKRAM) });
  assert.equal(res.status, 200);
  assert.equal((await approvalById(STEP2)).status, "PENDING");
  assert.equal(await bookingStatus(), "PENDING_APPROVAL");
  await waitFor(() => textsTo(VIKRAM_WA).length === 1, "refusal");
  assert.match(textsTo(VIKRAM_WA)[0], /^Couldn't record that: Waiting for tier-1 sign-off from Arjun/);
});

test("a second press on a decided step changes nothing", async () => {
  await metaPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN) });
  await metaPress({ from: ARJUN_WA, buttonId: button(STEP1, "REJECTED", ARJUN) });
  assert.equal((await approvalById(STEP1)).status, "APPROVED");
  assert.equal(await bookingStatus(), "PENDING_APPROVAL");
  await waitFor(() => textsTo(ARJUN_WA).length === 2, "both replies");
  assert.match(textsTo(ARJUN_WA)[1], /already been decided/);
});

test("Meta redelivering the same message decides it once", async () => {
  const press = { from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN), id: "wamid.redelivered" };
  assert.equal((await metaPress(press)).status, 200);
  assert.equal((await metaPress(press)).status, 200);
  await waitFor(() => textsTo(ARJUN_WA).length >= 1, "confirmation");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(textsTo(ARJUN_WA).length, 1, "one confirmation, no 'already decided' reply");
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("an unlinked number can't decide, even with a genuine button", async () => {
  await metaPress({ from: "919800000000", buttonId: button(STEP1, "APPROVED", ARJUN) });
  assert.equal((await approvalById(STEP1)).status, "PENDING");
  await waitFor(() => textsTo("919800000000").length === 1, "refusal");
  assert.match(textsTo("919800000000")[0], /isn't linked to a Lufer approver/);
});

test("a forwarded button pressed by another approver is refused", async () => {
  await metaPress({ from: VIKRAM_WA, buttonId: button(STEP1, "APPROVED", ARJUN) });
  assert.equal((await approvalById(STEP1)).status, "PENDING");
  await waitFor(() => textsTo(VIKRAM_WA).length === 1, "refusal");
  assert.match(textsTo(VIKRAM_WA)[0], /isn't valid any more/);
});

test("a tampered button (Reject flipped to Approve) is refused", async () => {
  const [prefix, id, , mac] = button(STEP1, "REJECTED", ARJUN).split(":");
  await metaPress({ from: ARJUN_WA, buttonId: `${prefix}:${id}:A:${mac}` });
  assert.equal((await approvalById(STEP1)).status, "PENDING");
  await waitFor(() => textsTo(ARJUN_WA).length === 1, "refusal");
  assert.match(textsTo(ARJUN_WA)[0], /isn't valid any more/);
});

test("a button signed with another secret is refused", async () => {
  await metaPress({ from: ARJUN_WA, buttonId: approvalButtonId(STEP1, "APPROVED", ARJUN, "someone-elses-secret") });
  assert.equal((await approvalById(STEP1)).status, "PENDING");
});

test("an approver who lost the Approver role can't decide", async () => {
  await mutateDb((db) => {
    db.users.find((u) => u.user_id === ARJUN).corporate_role = "ORGANIZER";
  });
  await metaPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN) });
  assert.equal((await approvalById(STEP1)).status, "PENDING");
  await waitFor(() => textsTo(ARJUN_WA).length === 1, "refusal");
  assert.match(textsTo(ARJUN_WA)[0], /only users with the Approver role/);
});

test("with WHATSAPP_APPROVAL_SECRET unset, presses decide nothing", async () => {
  const id = button(STEP1, "APPROVED", ARJUN);
  delete process.env.WHATSAPP_APPROVAL_SECRET;
  await metaPress({ from: ARJUN_WA, buttonId: id });
  assert.equal((await approvalById(STEP1)).status, "PENDING");
});

test("while the WhatsApp channel is paused, presses are acknowledged and dropped", async () => {
  await channelStore().setEnabled("whatsapp", false);
  assert.equal((await metaPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN) })).status, 200);
  assert.equal((await twilioPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN) })).status, 200);
  assert.equal((await approvalById(STEP1)).status, "PENDING");
});

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

test("a Twilio press decides, and the confirmation goes back through Twilio", async () => {
  const res = await twilioPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN) });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "<Response/>");
  assert.equal((await approvalById(STEP1)).status, "APPROVED");
  await waitFor(() => sent.some((s) => s.provider === "twilio"), "Twilio confirmation");
  const reply = sent.find((s) => s.provider === "twilio").body;
  assert.equal(reply.To, `whatsapp:+${ARJUN_WA}`);
  assert.match(reply.Body, /^Approved: /);
});

test("Twilio signs the configured public URL when TWILIO_WEBHOOK_URL is set", async () => {
  process.env.TWILIO_WEBHOOK_URL = "https://public.example/api/webhooks/whatsapp";
  // Signed for the request URL, not the configured one: refused.
  assert.equal((await twilioPress({ from: ARJUN_WA, buttonId: button(STEP1, "APPROVED", ARJUN) })).status, 401);
});

// ---------------------------------------------------------------------------
// Sending requests
// ---------------------------------------------------------------------------

test("notifyApprovers sends the open step to its linked approver, and skips one with no number", async () => {
  assert.deepEqual(await notifyApprovers(NIMBUS, { bookingId: BOOKING }), [{ approvalId: STEP1, status: "sent" }]);
  assert.equal(buttonsTo(ARJUN_WA).length, 1);

  await channelStore().removeLink("whatsapp", ARJUN_WA);
  const [skipped] = await notifyApprovers(NIMBUS, { bookingId: BOOKING });
  assert.equal(skipped.status, "skipped");
});

test("notifyApprovers sends nothing for steps already notified, queued steps, or a cancelled request", async () => {
  assert.deepEqual(await notifyApprovers(NIMBUS, { bookingId: BOOKING }, new Set([STEP1])), []);
  await mutateDb((db) => {
    db.bookings.find((b) => b.id === BOOKING).status = "CANCELLED";
  });
  assert.deepEqual(await notifyApprovers(NIMBUS, { bookingId: BOOKING }), []);
  assert.equal(sent.length, 0);
});

test("notifyApprovers is off without WHATSAPP_APPROVAL_SECRET", async () => {
  delete process.env.WHATSAPP_APPROVAL_SECRET;
  assert.deepEqual(await notifyApprovers(NIMBUS, { bookingId: BOOKING }), []);
  assert.equal(sent.length, 0);
});

test("with WHATSAPP_APPROVAL_TEMPLATE set, the request is a template with quick-reply payloads", async () => {
  process.env.WHATSAPP_APPROVAL_TEMPLATE = "spend_approval";
  await notifyApprovers(NIMBUS, { bookingId: BOOKING });
  const { template } = buttonsTo(ARJUN_WA)[0].body;
  assert.equal(template.name, "spend_approval");
  assert.equal(template.language.code, "en");
  const [body, approve, reject] = template.components;
  assert.doesNotMatch(body.parameters[0].text, /\n/, "template variables can't hold newlines");
  assert.deepEqual([approve.index, approve.parameters[0].payload], ["0", button(STEP1, "APPROVED", ARJUN)]);
  assert.deepEqual([reject.index, reject.parameters[0].payload], ["1", button(STEP1, "REJECTED", ARJUN)]);
});

test("over Twilio, the request uses the Content template with the button IDs as variables", async () => {
  for (const k of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) delete process.env[k];
  // No Content template: Twilio can't send buttons, so nothing goes out.
  assert.deepEqual(await notifyApprovers(NIMBUS, { bookingId: BOOKING }), []);

  process.env.TWILIO_APPROVAL_CONTENT_SID = "HX123";
  assert.deepEqual(await notifyApprovers(NIMBUS, { bookingId: BOOKING }), [{ approvalId: STEP1, status: "sent" }]);
  const msg = sent.find((s) => s.provider === "twilio").body;
  assert.equal(msg.To, `whatsapp:+${ARJUN_WA}`);
  assert.equal(msg.ContentSid, "HX123");
  const vars = JSON.parse(msg.ContentVariables);
  assert.deepEqual([vars[2], vars[3]], [button(STEP1, "APPROVED", ARJUN), button(STEP1, "REJECTED", ARJUN)]);
});

test("approving on the web sends the next step to its approver on WhatsApp", async () => {
  signIn({ role: "CLIENT", userId: ARJUN, companyId: NIMBUS, canApprove: true });
  const result = await approveEventSpend(STEP1, "APPROVED");
  assert.equal(result.ok, true, JSON.stringify(result));
  await waitFor(() => buttonsTo(VIKRAM_WA).length === 1, "step 2 request");
  assert.equal(buttonsTo(VIKRAM_WA)[0].body.interactive.action.buttons[0].reply.id, button(STEP2, "APPROVED", VIKRAM));
});
