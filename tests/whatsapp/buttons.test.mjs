// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// WhatsApp approval buttons (lib/approvals/whatsapp-buttons.ts): signed button
// IDs, reading Meta and Twilio button presses, and the message text.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  approvalButtonId,
  approvalRequestText,
  decisionReplyText,
  extractApprovalReplies,
  extractTwilioApprovalReply,
  parseApprovalButton,
  verifyApprovalButton,
} from "../../lib/approvals/whatsapp-buttons.ts";

const SECRET = "approval-secret";
const APPROVAL = "aaaaaaaa-0001-4000-8000-000000000001";
const OTHER_APPROVAL = "aaaaaaaa-0002-4000-8000-000000000002";
const APPROVER = "dddddddd-0002-4000-8000-000000000002";
const OTHER_APPROVER = "dddddddd-0005-4000-8000-000000000005";

const meta = (...messages) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages } }] }] });

test("a button ID round-trips: parsed and verified for the approver it was issued to", () => {
  for (const decision of ["APPROVED", "REJECTED"]) {
    const id = approvalButtonId(APPROVAL, decision, APPROVER, SECRET);
    const button = parseApprovalButton(id);
    assert.deepEqual({ approvalId: button.approvalId, decision: button.decision }, { approvalId: APPROVAL, decision });
    assert.equal(verifyApprovalButton(button, APPROVER, SECRET), true);
  }
});

test("button IDs fit Meta's 256-character limit and differ per decision", () => {
  const approve = approvalButtonId(APPROVAL, "APPROVED", APPROVER, SECRET);
  const reject = approvalButtonId(APPROVAL, "REJECTED", APPROVER, SECRET);
  assert.ok(approve.length <= 256, `${approve.length} characters`);
  assert.notEqual(approve, reject);
});

test("a button doesn't verify for another approver, a wrong secret or no secret", () => {
  const button = parseApprovalButton(approvalButtonId(APPROVAL, "APPROVED", APPROVER, SECRET));
  assert.equal(verifyApprovalButton(button, OTHER_APPROVER, SECRET), false);
  assert.equal(verifyApprovalButton(button, APPROVER, "other-secret"), false);
  assert.equal(verifyApprovalButton(button, APPROVER, ""), false);
  assert.equal(verifyApprovalButton(button, "", SECRET), false);
});

test("a Reject button can't be flipped to Approve, nor moved to another approval", () => {
  const [prefix, id, , mac] = approvalButtonId(APPROVAL, "REJECTED", APPROVER, SECRET).split(":");
  const flipped = parseApprovalButton(`${prefix}:${id}:A:${mac}`);
  assert.equal(flipped.decision, "APPROVED");
  assert.equal(verifyApprovalButton(flipped, APPROVER, SECRET), false);
  const moved = parseApprovalButton(`${prefix}:${OTHER_APPROVAL}:R:${mac}`);
  assert.equal(verifyApprovalButton(moved, APPROVER, SECRET), false);
});

test("anything else isn't parsed as a button", () => {
  const mac = approvalButtonId(APPROVAL, "APPROVED", APPROVER, SECRET).split(":")[3];
  for (const id of [
    "",
    null,
    undefined,
    "Approve",
    `apv2:${APPROVAL}:A:${mac}`,
    `apv1:not-a-uuid:A:${mac}`,
    `apv1:${APPROVAL}:X:${mac}`,
    `apv1:${APPROVAL}:A:`,
    `apv1:${APPROVAL}:A:${mac}:extra`,
  ]) {
    assert.equal(parseApprovalButton(id), null, String(id));
  }
});

test("Meta presses: interactive replies and template quick replies are read; text and foreign buttons are not", () => {
  const approve = approvalButtonId(APPROVAL, "APPROVED", APPROVER, SECRET);
  const reject = approvalButtonId(APPROVAL, "REJECTED", APPROVER, SECRET);
  const replies = extractApprovalReplies(
    meta(
      { id: "wamid.1", from: "919845012345", type: "interactive", interactive: { type: "button_reply", button_reply: { id: approve, title: "Approve" } } },
      { id: "wamid.2", from: "919845012345", type: "button", button: { payload: reject, text: "Reject" } },
      { id: "wamid.3", from: "919845012345", type: "text", text: { body: "approve" } },
      { id: "wamid.4", from: "919845012345", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "some-other-bot", title: "Yes" } } },
      { id: "wamid.5", from: "919845012345", type: "interactive", interactive: { type: "list_reply", list_reply: { id: approve } } }
    )
  );
  assert.deepEqual(replies, [
    { id: "wamid.1", from: "919845012345", buttonId: approve },
    { id: "wamid.2", from: "919845012345", buttonId: reject },
  ]);
  assert.deepEqual(extractApprovalReplies({ ...meta(), object: "page" }), []);
  assert.deepEqual(extractApprovalReplies(null), []);
});

test("Twilio presses: From becomes digits; a missing payload, sender or SID is no press", () => {
  const approve = approvalButtonId(APPROVAL, "APPROVED", APPROVER, SECRET);
  const params = new URLSearchParams({ MessageSid: "SM123", From: "whatsapp:+919845012345", ButtonPayload: approve, ButtonText: "Approve" });
  assert.deepEqual(extractTwilioApprovalReply(params), { id: "SM123", from: "919845012345", buttonId: approve });
  for (const drop of ["MessageSid", "From", "ButtonPayload"]) {
    const p = new URLSearchParams(params);
    p.delete(drop);
    assert.equal(extractTwilioApprovalReply(p), null, drop);
  }
  assert.equal(extractTwilioApprovalReply(new URLSearchParams({ MessageSid: "SM1", From: "whatsapp:+91984", Body: "hi" })), null);
});

test("the request text gives the approver the figures, the reason and the deadline", () => {
  const text = approvalRequestText({
    requesterName: "Priya Raman",
    companyName: "Nimbus",
    subjectName: "Saffron Terrace",
    eventDate: "2026-12-05",
    partySize: 60,
    perHead: 1800,
    total: 108000,
    reason: "Over the ₹1,500 per-head limit",
    tier: 2,
    dueAt: "2026-11-20T06:30:00.000Z",
  });
  assert.match(text, /^Approval needed \(tier 2\): Priya Raman at Nimbus/);
  assert.match(text, /Saffron Terrace · 5 Dec 2026/);
  assert.match(text, /60 × ₹1,800 = ₹1,08,000 \(before GST\)/);
  assert.match(text, /Why: Over the ₹1,500 per-head limit/);
  assert.match(text, /Decide by 20 Nov, 12:00 pm IST/i);
  assert.ok(text.length <= 1024);
});

test("the request text leaves out what it doesn't know, and is capped at 1024 characters", () => {
  const text = approvalRequestText({ requesterName: "A", companyName: "B", subjectName: "C", eventDate: "", partySize: 1, perHead: 1, total: 1, reason: null, tier: 1, dueAt: null });
  assert.doesNotMatch(text, /tier|Why|Decide by/);
  assert.match(text, /date to be set/);
  const long = approvalRequestText({ requesterName: "A", companyName: "B", subjectName: "C", eventDate: "2026-12-05", partySize: 1, perHead: 1, total: 1, reason: "x".repeat(2000), tier: 1, dueAt: null });
  assert.equal(long.length, 1024);
});

test("the approver's confirmation says what happens next", () => {
  assert.equal(decisionReplyText({ ok: true, decision: "APPROVED", subjectName: "Saffron Terrace", next: "venue" }), "Approved: Saffron Terrace. It's on its way to the venue.");
  assert.equal(decisionReplyText({ ok: true, decision: "APPROVED", subjectName: "Saffron Terrace", next: "next_approver" }), "Approved: Saffron Terrace. It now goes to the next approver.");
  assert.match(decisionReplyText({ ok: true, decision: "REJECTED", subjectName: "Saffron Terrace", next: "cancelled" }), /^Rejected: Saffron Terrace\. The request is cancelled/);
  assert.equal(decisionReplyText({ ok: false, message: "already decided." }), "Couldn't record that: already decided.");
});
