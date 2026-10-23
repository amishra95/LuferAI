/**
 * WhatsApp [Approve] / [Reject] buttons for spend approvals. Pure (no server
 * imports) so tests/whatsapp/*.test.mjs can exercise it; lib/approvals/whatsapp.ts
 * sends the buttons and acts on the replies.
 *
 * A button's ID is `apv1:<approval id>:<A|R>:<mac>`, where the MAC is an
 * HMAC-SHA256 (WHATSAPP_APPROVAL_SECRET) over the approval, the decision and
 * the approver it was sent to. A reply is acted on only when the MAC matches
 * the approval's assigned approver, so a button can't be forged, replayed for
 * another approval, or flipped from Reject to Approve. Who pressed it is
 * checked separately (the sender's number must be linked to that approver).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type ApprovalDecision = "APPROVED" | "REJECTED";

const PREFIX = "apv1";
const CODE: Record<ApprovalDecision, "A" | "R"> = { APPROVED: "A", REJECTED: "R" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 24 bytes of HMAC, base64url: 32 characters. The whole ID stays well under Meta's 256. */
const MAC_BYTES = 24;

function mac(approvalId: string, decision: ApprovalDecision, approverId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PREFIX}:${approvalId.toLowerCase()}:${CODE[decision]}:${approverId.toLowerCase()}`, "utf8").digest().subarray(0, MAC_BYTES).toString("base64url");
}

/** The button ID for one decision on one approval, bound to the approver it's sent to. */
export function approvalButtonId(approvalId: string, decision: ApprovalDecision, approverId: string, secret: string): string {
  if (!secret) throw new Error("WHATSAPP_APPROVAL_SECRET is not set.");
  return `${PREFIX}:${approvalId.toLowerCase()}:${CODE[decision]}:${mac(approvalId, decision, approverId, secret)}`;
}

export interface ApprovalButton {
  approvalId: string;
  decision: ApprovalDecision;
  mac: string;
}

/** Reads a button ID's parts, or null when it isn't one of ours. Doesn't check the MAC. */
export function parseApprovalButton(id: string | null | undefined): ApprovalButton | null {
  const parts = (id ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX || !UUID.test(parts[1]) || (parts[2] !== "A" && parts[2] !== "R") || !parts[3]) return null;
  return { approvalId: parts[1].toLowerCase(), decision: parts[2] === "A" ? "APPROVED" : "REJECTED", mac: parts[3] };
}

/** True when the button was issued by us, for this decision, to `approverId`. */
export function verifyApprovalButton(button: ApprovalButton, approverId: string, secret: string): boolean {
  if (!secret || !approverId) return false;
  const given = Buffer.from(button.mac);
  const expected = Buffer.from(mac(button.approvalId, button.decision, approverId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ----------------------------------------------------------------------------
// Inbound replies
// ----------------------------------------------------------------------------

/** A button press: the platform's message ID (for de-duplication), the sender's digits and the button ID. */
export interface ApprovalReply {
  id: string;
  /** Digits only, as a WhatsApp ID (wa_id): 919845012345. */
  from: string;
  buttonId: string;
}

type MetaMessage = {
  id?: string;
  from?: string;
  type?: string;
  interactive?: { type?: string; button_reply?: { id?: string } };
  button?: { payload?: string };
};
type MetaPayload = { object?: string; entry?: { changes?: { field?: string; value?: { messages?: MetaMessage[] } }[] }[] };

/**
 * Button presses from a Cloud API webhook: replies to an interactive message
 * (inside the 24-hour window) and quick replies on a template (outside it).
 */
export function extractApprovalReplies(payload: unknown): ApprovalReply[] {
  const p = payload as MetaPayload;
  if (p?.object !== "whatsapp_business_account") return [];
  return (p.entry ?? []).flatMap((e) =>
    (e.changes ?? [])
      .filter((c) => c.field === "messages")
      .flatMap((c) => c.value?.messages ?? [])
      .flatMap((m) => {
        const buttonId = m.type === "interactive" && m.interactive?.type === "button_reply" ? m.interactive.button_reply?.id : m.type === "button" ? m.button?.payload : undefined;
        return m.id && m.from && buttonId && parseApprovalButton(buttonId) ? [{ id: m.id, from: m.from, buttonId }] : [];
      })
  );
}

/** A Twilio WhatsApp callback's button press (form fields ButtonPayload, From "whatsapp:+91…", MessageSid). */
export function extractTwilioApprovalReply(params: URLSearchParams): ApprovalReply | null {
  const buttonId = params.get("ButtonPayload") ?? "";
  const from = (params.get("From") ?? "").replace(/^whatsapp:/, "").replace(/\D/g, "");
  const id = params.get("MessageSid") ?? "";
  return id && from && parseApprovalButton(buttonId) ? { id, from, buttonId } : null;
}

// ----------------------------------------------------------------------------
// Message text
// ----------------------------------------------------------------------------

export interface ApprovalSummary {
  requesterName: string;
  companyName: string;
  /** Venue (booking) or item (catalogue order). */
  subjectName: string;
  /** YYYY-MM-DD */
  eventDate: string;
  partySize: number;
  perHead: number;
  total: number;
  reason: string | null;
  /** 1 = manager, 2+ = senior sign-off. */
  tier: number | null;
  dueAt: string | null;
}

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DUE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The request as the approver reads it on their phone. Meta caps an interactive body at 1024 characters. */
export function approvalRequestText(s: ApprovalSummary): string {
  const lines = [
    `Approval needed${s.tier && s.tier > 1 ? ` (tier ${s.tier})` : ""}: ${s.requesterName} at ${s.companyName}`,
    "",
    `${s.subjectName} · ${s.eventDate ? DATE.format(new Date(`${s.eventDate}T00:00:00Z`)) : "date to be set"}`,
    `${s.partySize} × ${INR.format(s.perHead)} = ${INR.format(s.total)} (before GST)`,
    ...(s.reason ? [`Why: ${s.reason}`] : []),
    ...(s.dueAt ? [`Decide by ${DUE.format(new Date(s.dueAt))} IST`] : []),
  ];
  return lines.join("\n").slice(0, 1024);
}

/** What the approver is told after pressing a button. */
export function decisionReplyText(outcome: { ok: true; decision: ApprovalDecision; subjectName: string; next: "venue" | "next_approver" | "cancelled" | "none" } | { ok: false; message: string }): string {
  if (!outcome.ok) return `Couldn't record that: ${outcome.message}`;
  const done = outcome.decision === "APPROVED" ? `Approved: ${outcome.subjectName}.` : `Rejected: ${outcome.subjectName}.`;
  const next = {
    venue: " It's on its way to the venue.",
    next_approver: " It now goes to the next approver.",
    cancelled: " The request is cancelled and the requester will see why in Lufer.ai.",
    none: "",
  }[outcome.next];
  return done + next;
}
