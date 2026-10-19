import { before, test } from "node:test";
import assert from "node:assert/strict";

import { canAccessWorkspace } from "../lib/auth/roles.ts";
import {
  CALLBACK_ACK,
  CallbackVerificationError,
  cancelSignatureRequest,
  eventHash,
  getSignatureRequest,
  sendSignatureRequest,
  updatesFrom,
  verifyCallback,
} from "../lib/services/contracts/dropboxSign.ts";
import { afterSignature, awaitedParty, canMove, canViewContract, canVoid, issueRefusal, signingParty } from "../lib/services/contracts/lifecycle.ts";
import { escapeHtml, exportWithCertificate, renderContract, sha256 } from "../lib/services/contracts/render.ts";
import { BALANCE_DUE_DAYS, depositTotal, describeSchedule, payability, planInstalments } from "../lib/services/contracts/schedule.ts";
import { TEMPLATE } from "../lib/services/contracts/template.ts";
import { buildContractTerms, contractNumber, istDate } from "../lib/services/contracts/terms.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

// =============================================================================================
// Terms and rendering
// =============================================================================================

const intra = { taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, total: 118000 };

function termsInput(over = {}) {
  return {
    booking: {
      id: "bbbbbbbb-0001-4000-8000-000000000001",
      event_date: "2026-11-20",
      party_size: 40,
      budget_per_head_inr: 2500,
      list_budget_per_head_inr: 2800,
      total_amount_inr: 100000,
      rate_card_id: "rc-1",
      alcohol_included: true,
      entertainment: ["live_music", "dj"],
      notes: "Q3 offsite dinner",
      cost_center: "ENG-BLR",
      project_code: "FY27-SKO",
      billing_gstin: null,
    },
    company: { legal_name: "Nimbus Analytics Private Limited", gstin: "29AABCN4821K1ZA", primary_contact_email: "events@nimbus.example" },
    venue: { name: "The Permit Room", neighborhood: "Indiranagar", city: "Bengaluru", address: "12 100 Feet Rd", gstin: "29AAACT1234Q1Z5", min_spend_inr: 60000, min_spend_per_head_inr: 1500 },
    invoice: { taxable_value: 100000, gst_type: "CGST_SGST", tax_breakup: { cgst: { amount: 9000 }, sgst: { amount: 9000 }, igst: { amount: 0 } }, total_tax: 18000, invoice_total: 118000, sac: { code: "998596" }, tax: { rate_percent: 18 } },
    cancellation: [
      { days_before: 14, refund_pct: 100 },
      { days_before: 7, refund_pct: 50 },
    ],
    depositRate: 0.25,
    instalments: describeSchedule(planInstalments({ invoice: intra, depositRate: 0.25, eventDate: "2026-11-20", today: "2026-10-20" })),
    department: "Engineering",
    poNumber: "PO-2026-014",
    approvals: [
      { step: 2, approverName: "Director", status: "APPROVED", decidedAt: "2026-10-18T10:00:00Z", note: "ok for SKO", escalatedFrom: null },
      { step: 1, approverName: "Manager", status: "ESCALATED", decidedAt: "2026-10-16T10:00:00Z", note: null, escalatedFrom: null },
      { step: 1, approverName: "CFO", status: "APPROVED", decidedAt: "2026-10-17T10:00:00Z", note: null, escalatedFrom: "x" },
    ],
    approvalReason: "₹1,00,000 falls in the “Large” band",
    revision: 1,
    issuedAt: new Date("2026-10-20T03:00:00Z"),
    ...over,
  };
}

test("terms: contract number, IST issue date, and only approved sign-offs in step order", () => {
  const t = buildContractTerms(termsInput());
  assert.equal(t.contractNumber, "LUF-BBBBBBBB-R1");
  assert.equal(contractNumber("bbbbbbbb-0001-4000-8000-000000000001", 3), "LUF-BBBBBBBB-R3");
  assert.equal(istDate(new Date("2026-10-19T20:00:00Z")), "2026-10-20", "01:30 IST is the next day");
  assert.deepEqual(t.approvals.map((a) => [a.step, a.approverName, a.escalated]), [[1, "CFO", true], [2, "Director", false]]);
  assert.deepEqual(t.event.entertainment, ["dj", "live_music"], "sorted, so the document is stable");
  assert.equal(t.pricing.rateCardApplied, true);
});

test("render: the same terms give the same bytes and hash; changed terms don't", () => {
  const a = renderContract(buildContractTerms(termsInput()));
  const b = renderContract(buildContractTerms(termsInput()));
  assert.equal(a.html, b.html);
  assert.equal(a.sha256, b.sha256);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.sha256, sha256(a.html));
  assert.deepEqual(a.template, TEMPLATE);
  const changed = renderContract(buildContractTerms(termsInput({ revision: 2 })));
  assert.notEqual(changed.sha256, a.sha256);
});

test("render: merges price, GST heads, schedule, venue rules and sign-offs into the agreement", () => {
  const { html } = renderContract(buildContractTerms(termsInput()));
  for (const s of [
    "Venue Services Agreement",
    "Nimbus Analytics Private Limited",
    "GSTIN 29AABCN4821K1ZA",
    "The Permit Room, 12 100 Feet Rd, Indiranagar, Bengaluru",
    "20 November 2026",
    "list ₹2,800.00, corporate rate applied",
    "CGST 9%",
    "SGST 9%",
    "₹1,18,000.00",
    "Deposit (25%)",
    "₹29,500.00 · due on signature of this Agreement",
    `due ${new Date("2026-11-13T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`,
    "Minimum spend for the venue: ₹60,000.00",
    "Full refund 14+ days before · 50% refund 7–13 days before · no refund under 7 days",
    "PO-2026-014",
    "Step 1: approved by CFO on 17 October 2026 (escalated)",
    "Step 2: approved by Director on 18 October 2026 — “ok for SKO”",
    "Information Technology Act, 2000",
    `template ${TEMPLATE.key} v${TEMPLATE.version}`,
  ]) {
    assert.ok(html.includes(escapeHtml(s)), `missing: ${s}`);
  }
  assert.doesNotMatch(html, /IGST/);

  const inter = renderContract(
    buildContractTerms(termsInput({ invoice: { ...termsInput().invoice, gst_type: "IGST", tax_breakup: { cgst: { amount: 0 }, sgst: { amount: 0 }, igst: { amount: 18000 } } } }))
  ).html;
  assert.match(inter, /IGST 18%/);
  assert.match(inter, /inter-state supply/);
});

test("render: everything interpolated is escaped, and no-approval bookings say so", () => {
  const evil = termsInput({ booking: { ...termsInput().booking, notes: `<script>alert("x")</script> & "quotes"` }, approvals: [], approvalReason: null });
  const { html } = renderContract(buildContractTerms(evil));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;quotes&quot;/);
  assert.match(html, /needed no internal sign-off/);
});

test("export: the certificate goes after the document, which stays byte-identical", () => {
  const doc = renderContract(buildContractTerms(termsInput()));
  const contract = { document_html: doc.html, document_sha256: doc.sha256, status: "executed", provider: "in_app" };
  const sig = { party: "client", signer_name: "Asha <Rao>", signer_title: "CFO", signer_email: "asha@nimbus.example", signed_at: "2026-10-20T05:00:00Z", ip_address: "203.0.113.9", document_sha256: doc.sha256, provider_signature_id: null };
  const out = exportWithCertificate(contract, [{ ...sig, party: "venue", signer_name: "GM" }, sig]);
  assert.ok(out.startsWith(doc.html.slice(0, doc.html.lastIndexOf("</body>"))));
  assert.ok(out.endsWith("</body></html>"));
  assert.match(out, /Signature certificate/);
  assert.match(out, /matches this fingerprint/);
  assert.match(out, /Asha &lt;Rao&gt;, CFO/);
  assert.ok(out.indexOf("<h2>Client</h2>") < out.indexOf("<h2>Venue</h2>"), "client first");

  const tampered = exportWithCertificate({ ...contract, document_html: doc.html.replace("Nimbus", "Nimbuz") }, []);
  assert.match(tampered, /WARNING: the stored document does not match/);
  assert.match(tampered, /Not signed yet/);
});

// =============================================================================================
// Payment schedule
// =============================================================================================

const sum = (xs, k) => Math.round(xs.reduce((n, x) => n + x[k] * 100, 0)) / 100;

test("schedule: deposit on execution, balance a week before the event; both add up to the invoice to the paisa", () => {
  const plan = planInstalments({ invoice: intra, depositRate: 0.25, eventDate: "2026-11-20", today: "2026-10-20" });
  assert.deepEqual(plan.map((i) => [i.kind, i.total, i.issueOn, i.dueOn]), [
    ["deposit", 29500, "2026-10-20", "2026-10-20"],
    ["balance", 88500, "2026-11-06", "2026-11-13"],
  ]);
  for (const k of ["taxable", "cgst", "sgst", "igst", "total"]) assert.equal(sum(plan, k), intra[k], k);
  for (const i of plan) assert.equal(Math.round((i.taxable + i.cgst + i.sgst + i.igst) * 100), Math.round(i.total * 100), `${i.kind} adds up`);
  assert.equal(BALANCE_DUE_DAYS, 7);
});

test("schedule: awkward amounts, IGST and an event inside a week still reconcile", () => {
  const odd = { taxable: 33333.33, cgst: 0, sgst: 0, igst: 6000, total: 39333.33 };
  const plan = planInstalments({ invoice: odd, depositRate: 0.3333, eventDate: "2026-10-23", today: "2026-10-20" });
  for (const k of ["taxable", "cgst", "sgst", "igst", "total"]) assert.equal(sum(plan, k), odd[k], k);
  assert.equal(plan[1].dueOn, "2026-10-20", "a balance that would be due in the past is due today");
  assert.equal(plan[1].issueOn, "2026-10-20");
  assert.equal(depositTotal(39333.33, 0.3333), 13109.8);
});

test("schedule: a deposit paid before the contract sets the deposit; a full prepayment leaves no balance", () => {
  const plan = planInstalments({ invoice: intra, depositRate: 0.25, eventDate: "2026-11-20", today: "2026-10-20", depositInr: 30000 });
  assert.deepEqual(plan.map((i) => i.total), [30000, 88000]);
  assert.deepEqual(planInstalments({ invoice: intra, depositRate: 1, eventDate: "2026-11-20", today: "2026-10-20" }).map((i) => i.kind), ["deposit"]);
  assert.throws(() => planInstalments({ invoice: intra, depositRate: 0.25, eventDate: "2026-11-20", today: "2026-10-20", depositInr: 0 }), /more than ₹0/);
  assert.deepEqual(describeSchedule(plan).map((i) => i.due), ["on execution", "2026-11-13"]);
});

test("payability: only issued invoices can be paid", () => {
  assert.deepEqual(payability({ status: "issued", total_inr: 10 }), { ok: true });
  assert.match(payability({ status: "scheduled", total_inr: 10 }).reason, /Not issued/);
  assert.match(payability({ status: "paid", total_inr: 10 }).reason, /Already paid/);
  assert.match(payability({ status: "void", total_inr: 10 }).reason, /Voided/);
});

// =============================================================================================
// Lifecycle and who signs
// =============================================================================================

const C = { tenant_id: "nimbus", venue_id: "permit", status: "awaiting_client" };
const approver = { role: "CLIENT", companyId: "nimbus", venueId: null, corporateRole: "APPROVER" };
const organizer = { ...approver, corporateRole: "ORGANIZER" };
const venueManager = { role: "PROPERTY", companyId: null, venueId: "permit", corporateRole: null };
const admin = { role: "ADMIN", companyId: null, venueId: null, corporateRole: null };

test("lifecycle: the client signs, then the venue countersigns; nothing moves after execution", () => {
  assert.deepEqual(afterSignature("awaiting_client", "client"), { ok: true, status: "awaiting_venue" });
  assert.deepEqual(afterSignature("awaiting_venue", "venue"), { ok: true, status: "executed" });
  assert.match(afterSignature("awaiting_client", "venue").reason, /client signs first/);
  assert.match(afterSignature("awaiting_venue", "client").reason, /already signed/);
  assert.match(afterSignature("executed", "venue").reason, /executed/);
  assert.equal(canMove("executed", "voided"), false);
  assert.equal(canMove("awaiting_venue", "declined"), true);
  assert.equal(awaitedParty("declined"), null);
});

test("signing: an Approver signs for the client, the venue's manager countersigns, admins never sign", () => {
  assert.deepEqual(signingParty(approver, C), { ok: true, party: "client" });
  assert.match(signingParty(organizer, C).reason, /Only an Approver/);
  assert.match(signingParty(venueManager, C).reason, /client signs first/);
  assert.deepEqual(signingParty(venueManager, { ...C, status: "awaiting_venue" }), { ok: true, party: "venue" });
  assert.match(signingParty(approver, { ...C, status: "awaiting_venue" }).reason, /waiting for the venue/);
  assert.match(signingParty(admin, C).reason, /Only the client's Approvers/);
  assert.match(signingParty({ ...approver, companyId: "vertex" }, C).reason, /Only the client's Approvers/);
  assert.match(signingParty({ ...venueManager, venueId: "other" }, { ...C, status: "awaiting_venue" }).reason, /Only the client's/);
});

test("viewing, voiding and issuing", () => {
  assert.equal(canViewContract(organizer, C), true);
  assert.equal(canViewContract({ ...organizer, companyId: "vertex" }, C), false);
  assert.equal(canViewContract(venueManager, C), true);
  assert.equal(canViewContract(admin, C), true);
  assert.equal(canVoid(organizer, C), false);
  assert.equal(canVoid(approver, C), true);
  assert.equal(canVoid(venueManager, { ...C, status: "awaiting_venue" }), true);
  assert.equal(canVoid(admin, { ...C, status: "executed" }), false, "an executed contract stands");

  const booking = { company_id: "nimbus", venue_id: "permit", status: "PENDING" };
  assert.equal(issueRefusal(organizer, booking, false), null);
  assert.equal(issueRefusal(venueManager, booking, false), null);
  assert.match(issueRefusal({ ...organizer, corporateRole: "FINANCE_VIEWER" }, booking, false), /Only the booking's company/);
  assert.match(issueRefusal(organizer, { ...booking, status: "PENDING_APPROVAL" }, false), /awaiting internal approval/);
  assert.match(issueRefusal(organizer, { ...booking, status: "CONFIRMED" }, false), /this one is confirmed/);
  assert.match(issueRefusal(organizer, booking, true), /already has a live contract/);
});

test("roles: contracts are open to the booking's company, its venue and admins", () => {
  for (const c of ["ORGANIZER", "APPROVER", "FINANCE_VIEWER"]) assert.equal(canAccessWorkspace("CLIENT", c, "/contracts"), true, c);
  assert.equal(canAccessWorkspace("PROPERTY", null, "/contracts"), true);
  assert.equal(canAccessWorkspace("ADMIN", null, "/contracts"), true);
  assert.equal(canAccessWorkspace("PARTNER", null, "/contracts"), false);
  assert.equal(canAccessWorkspace("PROPERTY", null, "/governance"), false, "party access doesn't widen other areas");
});

// =============================================================================================
// Dropbox Sign
// =============================================================================================

const KEY = "test-api-key";
const rawRequest = (signatures, over = {}) => ({ signature_request_id: "sr_1", metadata: { contract_id: "c-1" }, is_complete: false, is_declined: false, signatures, ...over });
const rawSig = (order, status, over = {}) => ({ signature_id: `sig_${order}`, order, signer_name: order === 0 ? "Asha" : "GM", signer_email_address: order === 0 ? "asha@nimbus.example" : "gm@permit.example", status_code: status, signed_at: status === "signed" ? 1792468800 : null, ...over });
const callback = (type, over = {}) => {
  const time = "1792468800";
  return JSON.stringify({ event: { event_time: time, event_type: type, event_hash: eventHash(KEY, time, type), event_metadata: { related_signature_id: "sig_0" } }, signature_request: rawRequest([rawSig(0, "signed"), rawSig(1, "awaiting_signature")]), ...over });
};

test("callbacks: a valid event_hash verifies; a forged or missing one is refused", () => {
  const e = verifyCallback(callback("signature_request_signed"), KEY);
  assert.deepEqual([e.kind, e.requestId, e.signatureId, e.eventId], ["signed", "sr_1", "sig_0", "sr_1:signature_request_signed:1792468800:sig_0"]);
  assert.equal(verifyCallback(callback("callback_test"), KEY).kind, "test");
  assert.equal(verifyCallback(callback("signature_request_viewed"), KEY).kind, "other");

  assert.throws(() => verifyCallback(callback("signature_request_signed"), "another-key"), CallbackVerificationError);
  const forged = JSON.parse(callback("signature_request_signed"));
  forged.event.event_type = "signature_request_all_signed"; // hash was for "signed"
  assert.throws(() => verifyCallback(JSON.stringify(forged), KEY), /Bad event_hash/);
  assert.throws(() => verifyCallback("not json", KEY), /not JSON/);
  assert.throws(() => verifyCallback(JSON.stringify({ event: {} }), KEY), /no event/);
  assert.equal(CALLBACK_ACK, "Hello API Event Received");
});

test("callbacks: updates come from the API's view, client before venue, skipping what's recorded", () => {
  const both = { requestId: "sr_1", contractId: "c-1", isComplete: true, isDeclined: false, signatures: [{ signatureId: "s1", order: 1, name: "GM", email: "", status: "signed", signedAt: "x" }, { signatureId: "s0", order: 0, name: "Asha", email: "", status: "signed", signedAt: "x" }] };
  assert.deepEqual(updatesFrom(both, [], { kind: "all_signed" }).map((u) => [u.kind, u.party]), [["sign", "client"], ["sign", "venue"]]);
  assert.deepEqual(updatesFrom(both, ["client"], { kind: "all_signed" }).map((u) => u.party), ["venue"]);
  assert.deepEqual(updatesFrom(both, ["client", "venue"], { kind: "all_signed" }), []);

  const declined = { ...both, isComplete: false, isDeclined: true, signatures: [{ ...both.signatures[1], order: 0, status: "declined", name: "Asha" }] };
  assert.deepEqual(updatesFrom(declined, [], { kind: "declined" }), [{ kind: "decline", party: "client", signer: "Asha" }]);
  assert.deepEqual(updatesFrom({ ...both, signatures: [] }, [], { kind: "canceled" }), [{ kind: "cancel" }]);
});

/** A fetch double that records calls and answers from a table of path → response. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = String(url).replace("https://api.hellosign.com/v3", "");
    const route = routes[path];
    if (!route) return new Response(JSON.stringify({ error: { error_msg: "not found" } }), { status: 404 });
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
  };
  return { impl, calls };
}

test("Dropbox Sign API: sends signers in order with the document and our contract id; reads and cancels requests", async () => {
  const { impl, calls } = fakeFetch({
    "/signature_request/send": { body: { signature_request: rawRequest([rawSig(0, "awaiting_signature"), rawSig(1, "awaiting_signature")]) } },
    "/signature_request/sr_1": { body: { signature_request: rawRequest([rawSig(0, "signed"), rawSig(1, "awaiting_signature")]) } },
    "/signature_request/cancel/sr_1": { status: 410 },
  });
  const sent = await sendSignatureRequest({
    apiKey: KEY,
    fetch: impl,
    title: "Agreement",
    subject: "Please sign",
    message: "m",
    signers: [{ name: "Asha", email: "asha@nimbus.example" }, { name: "GM", email: "gm@permit.example" }],
    fileName: "LUF-1-R1.html",
    html: "<html></html>",
    contractId: "c-1",
    testMode: true,
  });
  assert.equal(sent.requestId, "sr_1");
  const form = calls[0].init.body;
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);
  assert.deepEqual(
    ["signers[0][email_address]", "signers[0][order]", "signers[1][email_address]", "signers[1][order]", "metadata[contract_id]", "test_mode"].map((k) => form.get(k)),
    ["asha@nimbus.example", "0", "gm@permit.example", "1", "c-1", "1"]
  );
  assert.equal(form.get("files[0]").name, "LUF-1-R1.html");

  const got = await getSignatureRequest(KEY, "sr_1", impl);
  assert.deepEqual(got.signatures.map((s) => [s.order, s.status, s.signedAt]), [[0, "signed", new Date(1792468800 * 1000).toISOString()], [1, "awaiting_signature", null]]);
  assert.equal(got.contractId, "c-1");
  await cancelSignatureRequest(KEY, "sr_1", impl); // 410: already closed, fine
  await assert.rejects(getSignatureRequest(KEY, "missing", impl), /not found/);
});

// =============================================================================================
// Postgres (PGlite with every migration): triggers, numbering and RLS
// =============================================================================================

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const VENUE = "aaaaaaaa-0001-4000-8000-000000000001";
const OTHER_VENUE = "aaaaaaaa-0002-4000-8000-000000000002";
const U = {
  organizer: "f0000000-0000-4000-8000-000000000001",
  approver: "f0000000-0000-4000-8000-000000000002",
  manager: "f0000000-0000-4000-8000-000000000003",
  otherManager: "f0000000-0000-4000-8000-000000000004",
  vertex: "f0000000-0000-4000-8000-000000000005",
};

let db;
before(async () => {
  db = await createDatabase();
  for (const [name, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@example.test`]);
  await db.query(
    `insert into platform_users (user_id, role, company_id, venue_id, corporate_role) values
       ($1, 'CLIENT', $6, null, 'ORGANIZER'), ($2, 'CLIENT', $6, null, 'APPROVER'),
       ($3, 'PROPERTY', null, $8, null), ($4, 'PROPERTY', null, $9, null), ($5, 'CLIENT', $7, null, 'ORGANIZER')`,
    [U.organizer, U.approver, U.manager, U.otherManager, U.vertex, NIMBUS, VERTEX, VENUE, OTHER_VENUE]
  );
  await db.query(`update companies set contracts_required = true where id = $1`, [NIMBUS]);
});

const scratch = (fn) =>
  db.transaction(async (tx) => {
    const r = await fn(tx);
    await tx.rollback();
    return r;
  });
const one = async (tx, sql, params) => (await tx.query(sql, params)).rows[0];

async function newBooking(tx, { status = "PENDING", total = 100000 } = {}) {
  return (await one(tx, `insert into bookings (company_id, venue_id, party_size, budget_per_head_inr, total_amount_inr, status, event_date) values ($1, $2, 40, $3, $4, $5, '2026-11-20') returning id`, [NIMBUS, VENUE, total / 40, total, status])).id;
}

async function newContract(tx, bookingId, revision = 1) {
  const doc = renderContract(buildContractTerms(termsInput({ booking: { ...termsInput().booking, id: bookingId }, revision })));
  const row = await one(
    tx,
    `insert into contracts (tenant_id, booking_id, venue_id, revision, template_key, template_version, terms, document_html, document_sha256, issued_by)
     values ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, $8, $9) returning id, document_sha256`,
    [NIMBUS, bookingId, VENUE, revision, TEMPLATE.key, TEMPLATE.version, doc.html, doc.sha256, U.organizer]
  );
  return row;
}

const sign = (tx, contract, party, sha = contract.document_sha256) =>
  tx.query(`insert into contract_signatures (contract_id, party, signer_user_id, signer_name, document_sha256) values ($1, $2, $3, $4, $5)`, [contract.id, party, party === "client" ? U.approver : U.manager, party === "client" ? "Asha Rao" : "Venue GM", sha]);

const status = async (tx, table, id) => (await one(tx, `select status from ${table} where id = $1`, [id])).status;

test("db: a contract company's booking can't be confirmed directly; the countersignature confirms it", async () => {
  await scratch(async (tx) => {
    const booking = await newBooking(tx);
    await tx.query("savepoint s");
    await assert.rejects(tx.query(`update bookings set status = 'CONFIRMED' where id = $1`, [booking]), (e) => /confirmed by its signed contract/.test(e.message) && e.hint === "contract_required");
    await tx.query("rollback to savepoint s");

    const c = await newContract(tx, booking);
    await sign(tx, c, "client");
    assert.equal(await status(tx, "contracts", c.id), "awaiting_venue");
    assert.equal(await status(tx, "bookings", booking), "PENDING");
    await sign(tx, c, "venue");
    const row = await one(tx, `select status, executed_at from contracts where id = $1`, [c.id]);
    assert.equal(row.status, "executed");
    assert.ok(row.executed_at);
    assert.equal(await status(tx, "bookings", booking), "CONFIRMED");
    const actions = (await tx.query(`select action from contract_events where contract_id = $1 order by at`, [c.id])).rows.map((r) => r.action);
    assert.deepEqual(actions, ["client_signed", "executed"]);
  });
});

test("db: companies without the requirement still confirm directly", async () => {
  await scratch(async (tx) => {
    await tx.query(`update companies set contracts_required = false where id = $1`, [NIMBUS]);
    const booking = await newBooking(tx);
    await tx.query(`update bookings set status = 'CONFIRMED' where id = $1`, [booking]);
    assert.equal(await status(tx, "bookings", booking), "CONFIRMED");
  });
});

test("db: signing order, document hash and append-only signatures are enforced", async () => {
  await scratch(async (tx) => {
    const c = await newContract(tx, await newBooking(tx));
    const attempt = async (fn, re) => {
      await tx.query("savepoint s");
      await assert.rejects(fn(), re);
      await tx.query("rollback to savepoint s");
    };
    await attempt(() => sign(tx, c, "venue"), /isn't waiting for the venue's countersignature/);
    await attempt(() => sign(tx, c, "client", "0".repeat(64)), /doesn't match contract/);
    await attempt(() => tx.query(`update contracts set status = 'executed' where id = $1`, [c.id]), /cannot move to executed/);
    await sign(tx, c, "client");
    await attempt(() => sign(tx, c, "client"), /isn't waiting for the client's signature/);
    await attempt(() => tx.query(`update contract_signatures set signer_name = 'Someone else' where contract_id = $1`, [c.id]), /append-only/);
    await attempt(() => tx.query(`delete from contract_signatures where contract_id = $1`, [c.id]), /append-only/);
    await attempt(() => tx.query(`update contracts set document_html = '<p>new</p>' where id = $1`, [c.id]), /can't be edited/);
    await attempt(() => tx.query(`update contract_events set action = 'voided' where contract_id = $1`, [c.id]), /append-only/);
  });
});

test("db: one live contract per booking; voiding allows a new revision; a cancelled booking can't execute", async () => {
  await scratch(async (tx) => {
    const booking = await newBooking(tx);
    const r1 = await newContract(tx, booking, 1);
    await tx.query("savepoint s");
    await assert.rejects(newContract(tx, booking, 2), /contracts_one_live_per_booking/);
    await tx.query("rollback to savepoint s");
    await tx.query(`update contracts set status = 'voided', close_reason = 'guest count changed' where id = $1`, [r1.id]);
    assert.ok((await one(tx, `select closed_at from contracts where id = $1`, [r1.id])).closed_at);
    const r2 = await newContract(tx, booking, 2);
    await sign(tx, r2, "client");
    // The booking is cancelled under the half-signed contract: it's voided with it.
    await tx.query(`update bookings set status = 'CANCELLED' where id = $1`, [booking]);
    assert.equal(await status(tx, "contracts", r2.id), "voided");
    assert.equal((await one(tx, `select close_reason from contracts where id = $1`, [r2.id])).close_reason, "Booking cancelled");
  });
  await scratch(async (tx) => {
    // Cancelled by other means while awaiting the venue: the countersignature is refused.
    const booking = await newBooking(tx);
    const c = await newContract(tx, booking);
    await sign(tx, c, "client");
    await tx.query(`alter table bookings disable trigger bookings_close_contracts`);
    await tx.query(`update bookings set status = 'CANCELLED' where id = $1`, [booking]);
    await assert.rejects(sign(tx, c, "venue"), /no longer with the venue/);
  });
});

async function executed(tx) {
  const booking = await newBooking(tx);
  const c = await newContract(tx, booking);
  await sign(tx, c, "client");
  await sign(tx, c, "venue");
  return { booking, contract: c };
}

const invoice = (tx, { booking, contract }, kind, status, total = 59000, venue = VENUE) =>
  one(
    tx,
    `insert into booking_invoices (tenant_id, booking_id, contract_id, venue_id, kind, sequence, status, taxable_inr, cgst_inr, sgst_inr, total_inr, gst, issue_on, due_on)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, '{}'::jsonb, current_date, current_date + 30) returning id, invoice_number, status`,
    [NIMBUS, booking, contract.id, venue, kind, kind === "deposit" ? 1 : 2, status, Math.round((total / 1.18) * 100) / 100, Math.round(((total - Math.round((total / 1.18) * 100) / 100) / 2) * 100) / 100, total]
  );

test("db: invoices are numbered consecutively per venue per Indian FY when issued; scheduled ones have no number", async () => {
  await scratch(async (tx) => {
    const fy = (await one(tx, `select indian_fiscal_year((now() at time zone 'Asia/Kolkata')::date) fy`)).fy;
    assert.equal((await one(tx, `select indian_fiscal_year('2027-03-31') a, indian_fiscal_year('2027-04-01') b`)).a, "2026-27");
    assert.equal((await one(tx, `select indian_fiscal_year('2027-04-01') b`)).b, "2027-28");

    const first = await executed(tx);
    const deposit = await invoice(tx, first, "deposit", "issued");
    const balance = await invoice(tx, first, "balance", "scheduled");
    assert.equal(deposit.invoice_number, `${fy}/000001`);
    assert.equal(balance.invoice_number, null);
    await tx.query(`update booking_invoices set status = 'issued' where id = $1`, [balance.id]);
    assert.equal((await one(tx, `select invoice_number from booking_invoices where id = $1`, [balance.id])).invoice_number, `${fy}/000002`);

    await tx.query("savepoint s");
    await assert.rejects(tx.query(`update booking_invoices set total_inr = 1, taxable_inr = 1, cgst_inr = 0, sgst_inr = 0 where id = $1`, [deposit.id]), /issued and can't be changed/);
    await tx.query("rollback to savepoint s");
    await tx.query("savepoint s2");
    await assert.rejects(tx.query(`update booking_invoices set status = 'scheduled' where id = $1`, [deposit.id]), /cannot move to scheduled/);
    await tx.query("rollback to savepoint s2");
    await assert.rejects(invoice(tx, first, "deposit", "issued"), /booking_invoices_contract_kind_key/, "one deposit per contract");
  });
});

test("db: an invoice must add up; GST heads and total are checked", async () => {
  await scratch(async (tx) => {
    const e = await executed(tx);
    await assert.rejects(
      tx.query(
        `insert into booking_invoices (tenant_id, booking_id, contract_id, venue_id, kind, sequence, taxable_inr, cgst_inr, sgst_inr, total_inr, gst, issue_on, due_on)
         values ($1, $2, $3, $4, 'deposit', 1, 100, 9, 9, 120, '{}', current_date, current_date)`,
        [NIMBUS, e.booking, e.contract.id, VENUE]
      ),
      /booking_invoices_total_check/
    );
  });
});

const payment = (tx, booking, invoiceId, st = "authorized") =>
  one(
    tx,
    `insert into payments (booking_id, booking_invoice_id, provider, status, amount_inr, deposit_rate, provider_order_id, invoice) values ($1, $2, 'stripe', $3, 59000, 0.5, gen_random_uuid()::text, '{}') returning id`,
    [booking, invoiceId, st]
  );

test("db: a captured payment settles its instalment; each instalment and the pre-contract deposit get one live payment", async () => {
  await scratch(async (tx) => {
    const e = await executed(tx);
    const dep = await invoice(tx, e, "deposit", "issued");
    const bal = await invoice(tx, e, "balance", "issued");
    const p1 = await payment(tx, e.booking, dep.id);
    await tx.query(`update payments set status = 'captured' where id = $1`, [p1.id]);
    const row = await one(tx, `select status, paid_at, payment_id from booking_invoices where id = $1`, [dep.id]);
    assert.deepEqual([row.status, row.payment_id, Boolean(row.paid_at)], ["paid", p1.id, true]);

    await payment(tx, e.booking, bal.id); // a second live payment on the booking, for another instalment
    await payment(tx, e.booking, null, "captured"); // the pre-contract deposit checkout is still one per booking
    await tx.query("savepoint s");
    await assert.rejects(payment(tx, e.booking, bal.id), /payments_one_live_per_invoice/);
    await tx.query("rollback to savepoint s");
    await assert.rejects(payment(tx, e.booking, null, "authorized"), /payments_one_live_per_booking/);
  });
});

test("db: a deposit paid before the contract settles the deposit invoice it's linked to", async () => {
  await scratch(async (tx) => {
    const booking = await newBooking(tx);
    const early = await payment(tx, booking, null, "authorized");
    const c = await newContract(tx, booking);
    await sign(tx, c, "client");
    await sign(tx, c, "venue");
    const dep = await invoice(tx, { booking, contract: c }, "deposit", "issued");
    await tx.query(`update booking_invoices set payment_id = $1 where id = $2`, [early.id, dep.id]);
    await tx.query(`update payments set status = 'captured' where id = $1`, [early.id]);
    assert.equal(await status(tx, "booking_invoices", dep.id), "paid");
  });
});

test("db: cancelling an executed booking voids its unpaid invoices and keeps paid ones", async () => {
  await scratch(async (tx) => {
    const e = await executed(tx);
    const dep = await invoice(tx, e, "deposit", "paid");
    const bal = await invoice(tx, e, "balance", "scheduled");
    await tx.query(`update bookings set status = 'CANCELLED' where id = $1`, [e.booking]);
    assert.equal(await status(tx, "booking_invoices", dep.id), "paid");
    assert.equal(await status(tx, "booking_invoices", bal.id), "void");
    assert.equal(await status(tx, "contracts", e.contract.id), "executed", "an executed contract stands; refunds follow its terms");
  });
});

test("db: RLS — the company and its venue read a contract, its signatures, events and invoices; nobody else; portal users can't sign directly", async () => {
  const e = await executed(db);
  await invoice(db, e, "deposit", "issued");
  try {
    const count = (user, table) => asUser(db, user ? { claims: { sub: user } } : { role: "anon" }, async (tx) => Number((await one(tx, `select count(*) n from ${table}`)).n));
    for (const table of ["contracts", "contract_signatures", "contract_events", "booking_invoices"]) {
      assert.ok((await count(U.organizer, table)) >= 1, `company reads ${table}`);
      assert.ok((await count(U.manager, table)) >= 1, `venue reads ${table}`);
      assert.equal(await count(U.otherManager, table), 0, `another venue can't read ${table}`);
      assert.equal(await count(U.vertex, table), 0, `another company can't read ${table}`);
      assert.equal(await count(null, table), 0, `anon can't read ${table}`);
    }
    for (const table of ["contract_webhook_events", "invoice_number_series"]) assert.equal(await count(U.organizer, table), 0, `${table} is service-only`);

    const booking2 = await newBooking(db);
    const c2 = await newContract(db, booking2);
    try {
      await assert.rejects(
        asUser(db, { claims: { sub: U.approver } }, (tx) => sign(tx, c2, "client")),
        /row-level security/
      );
    } finally {
      await db.query(`delete from contracts where id = $1`, [c2.id]);
      await db.query(`delete from bookings where id = $1`, [booking2]);
    }
  } finally {
    await db.query(`delete from booking_invoices where booking_id = $1`, [e.booking]);
    await db.query(`delete from contracts where id = $1`, [e.contract.id]);
    await db.query(`delete from bookings where id = $1`, [e.booking]);
  }
});
