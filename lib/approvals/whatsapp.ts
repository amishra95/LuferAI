import "server-only";

import { after } from "next/server";

import { sendTwilioWhatsApp, sendWhatsAppMessage, whatsAppProvider, type WhatsAppProvider } from "@/lib/agent/connectors/whatsapp";
import {
  approvalButtonId,
  approvalRequestText,
  decisionReplyText,
  parseApprovalButton,
  verifyApprovalButton,
  type ApprovalDecision,
  type ApprovalReply,
} from "@/lib/approvals/whatsapp-buttons";
import { env } from "@/lib/channels/config";
import { channelStore } from "@/lib/channels/store";
import { sendWhatsAppMessageObject } from "@/lib/channels/whatsapp";
import { decideApproval, listApprovals, listBookings, listCatalogOrders, listPortalUsers, type ApprovalDetail } from "@/lib/data";
import { isActionable } from "@/lib/services/enterprise/approvalEngine";
import type { BookingStatus } from "@/lib/supabase/database.types";
import type { OrderEventStatus } from "@/lib/telemetry/events";
import { publishApproval, publishBooking, publishOrder } from "@/lib/telemetry/live";

/**
 * Spend approvals over WhatsApp. When a step becomes the approver's turn they
 * get the request with [Approve] / [Reject] buttons on the number linked to
 * them in Settings → Channels; pressing one decides it through the same
 * decideApproval as /client/approvals (tiers stay sequential, the booking
 * moves on the last approval or any rejection).
 *
 * Off unless WHATSAPP_APPROVAL_SECRET is set (it signs the button IDs, see
 * lib/approvals/whatsapp-buttons.ts) and a sender is configured:
 *   Meta     interactive buttons, which Meta delivers only inside the 24-hour
 *            window after the approver last messaged the business number. Set
 *            WHATSAPP_APPROVAL_TEMPLATE (an approved template with one body
 *            variable and two quick-reply buttons, Approve then Reject) to
 *            reach them outside it.
 *   Twilio   TWILIO_APPROVAL_CONTENT_SID: a Content template with quick-reply
 *            buttons whose IDs are {{2}} (Approve) and {{3}} (Reject), body {{1}}.
 */

export const approvalSecret = () => env("WHATSAPP_APPROVAL_SECRET");

/** Which sender approval requests go out on, or null when they're off. */
export function approvalSender(): WhatsAppProvider | null {
  if (!approvalSecret()) return null;
  const provider = whatsAppProvider();
  if (provider === "twilio" && !env("TWILIO_APPROVAL_CONTENT_SID")) return null;
  return provider;
}

type Subject = { bookingId: string } | { orderId: string };
const subjectOf = (a: Pick<ApprovalDetail, "booking_id" | "catalog_order_id">): Subject => (a.booking_id ? { bookingId: a.booking_id } : { orderId: a.catalog_order_id ?? "" });
const sameSubject = (a: Pick<ApprovalDetail, "booking_id" | "catalog_order_id">, s: Subject) => ("bookingId" in s ? a.booking_id === s.bookingId : a.catalog_order_id === s.orderId);

/** The approvals on a request it's someone's turn to decide (activated, still pending). */
async function actionableFor(tenantId: string, subject: Subject): Promise<ApprovalDetail[]> {
  return (await listApprovals({ tenantId, status: "PENDING" })).filter((a) => sameSubject(a, subject) && isActionable(a));
}

/**
 * Before deciding `approvalId`: the request it belongs to and the steps already
 * open on it, so the approvers notified afterwards are only the ones whose turn
 * the decision started. Null (and no query) while WhatsApp approvals are off.
 */
export async function approvalSnapshot(tenantId: string, approvalId: string): Promise<{ tenantId: string; subject: Subject; notified: Set<string> } | null> {
  if (!approvalSender()) return null;
  const approval = (await listApprovals({ tenantId })).find((a) => a.id === approvalId);
  if (!approval) return null;
  const subject = subjectOf(approval);
  return { tenantId, subject, notified: new Set((await actionableFor(tenantId, subject)).map((a) => a.id)) };
}

export type ApproverNotice = { approvalId: string; status: "sent" | "skipped" | "failed"; detail?: string };

/**
 * Sends each newly actionable step on a request to its approver's linked
 * WhatsApp number. Steps in `alreadyNotified` were open before and have had
 * theirs. Never throws.
 */
export async function notifyApprovers(tenantId: string, subject: Subject, alreadyNotified: ReadonlySet<string> = new Set()): Promise<ApproverNotice[]> {
  const sender = approvalSender();
  if (!sender) return [];
  try {
    const open = (await actionableFor(tenantId, subject)).filter((a) => !alreadyNotified.has(a.id));
    // A request that was cancelled or moved on has nothing left to decide.
    if (open.length === 0 || open[0].booking.status !== "PENDING_APPROVAL") return [];
    const links = await channelStore().listLinks("whatsapp");
    return await Promise.all(
      open.map(async (a): Promise<ApproverNotice> => {
        const link = links.find((l) => l.userId === a.approver_id && l.companyId === a.tenant_id);
        if (!link) return { approvalId: a.id, status: "skipped", detail: "No WhatsApp number linked to the approver." };
        try {
          await sendApprovalRequest(sender, link.senderId, a);
          return { approvalId: a.id, status: "sent" };
        } catch (err) {
          console.error(`approvals: WhatsApp request for ${a.id} failed`, err);
          return { approvalId: a.id, status: "failed", detail: err instanceof Error ? err.message : String(err) };
        }
      })
    );
  } catch (err) {
    console.error("approvals: could not send WhatsApp approval requests", err);
    return [];
  }
}

/** notifyApprovers after the response (next/server after()); outside a request the promise just runs. */
export function scheduleApproverNotifications(tenantId: string, subject: Subject, alreadyNotified?: ReadonlySet<string>): void {
  if (!approvalSender()) return;
  const work = notifyApprovers(tenantId, subject, alreadyNotified);
  try {
    after(work);
  } catch {
    // Outside a request (tests, scripts): the promise still runs.
  }
}

async function sendApprovalRequest(sender: WhatsAppProvider, waId: string, a: ApprovalDetail) {
  const secret = approvalSecret();
  const text = approvalRequestText({
    requesterName: a.requester_name,
    companyName: a.company.legal_name,
    subjectName: a.booking.venue_name,
    eventDate: a.booking.event_date,
    partySize: a.booking.party_size,
    perHead: Number(a.booking.budget_per_head_inr),
    total: Number(a.booking.total_amount_inr),
    reason: a.reason,
    tier: a.tier,
    dueAt: a.due_at,
  });
  const approve = approvalButtonId(a.id, "APPROVED", a.approver_id, secret);
  const reject = approvalButtonId(a.id, "REJECTED", a.approver_id, secret);
  // Template variables can't hold newlines.
  const oneLine = text.replace(/\n+/g, " · ");

  if (sender === "twilio") {
    await sendTwilioWhatsApp(`+${waId}`, { ContentSid: env("TWILIO_APPROVAL_CONTENT_SID"), ContentVariables: JSON.stringify({ 1: oneLine, 2: approve, 3: reject }) });
    return;
  }
  const template = env("WHATSAPP_APPROVAL_TEMPLATE");
  if (template) {
    await sendWhatsAppMessageObject(waId, {
      type: "template",
      template: {
        name: template,
        language: { code: env("WHATSAPP_APPROVAL_TEMPLATE_LANG") || "en" },
        components: [
          { type: "body", parameters: [{ type: "text", text: oneLine }] },
          { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: approve }] },
          { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: reject }] },
        ],
      },
    });
    return;
  }
  await sendWhatsAppMessageObject(waId, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: {
        buttons: [
          { type: "reply", reply: { id: approve, title: "Approve" } },
          { type: "reply", reply: { id: reject, title: "Reject" } },
        ],
      },
    },
  });
}

// ----------------------------------------------------------------------------
// Button presses
// ----------------------------------------------------------------------------

export interface ApprovalReplyOutcome {
  /** What the approver is told, on the provider the press came in on. */
  reply: string;
  to: string;
  provider: WhatsAppProvider;
  /** Set when a decision was recorded. */
  decided?: {
    approvalId: string;
    tenantId: string;
    subject: Subject;
    decision: ApprovalDecision;
    /** The booking's or order's status after the decision. */
    status: string | null;
    /** The venue (booking) or supplier (order), for live events. */
    counterpartyId: string;
    notified: Set<string>;
  };
}

const refused = (reply: ApprovalReply, provider: WhatsAppProvider, message: string): ApprovalReplyOutcome => ({ reply: decisionReplyText({ ok: false, message }), to: reply.from, provider });

/**
 * Decides an approval from a button press. The button must carry our MAC for
 * the approval's assigned approver, and the sender's number must be linked to
 * that same approver, who must still hold the Approver role. Outcomes the
 * approver should hear about (already decided, not their turn) come back as
 * the reply; only a store failure throws, so the webhook answers 503 and the
 * platform retries.
 */
export async function decideFromWhatsApp(reply: ApprovalReply, provider: WhatsAppProvider): Promise<ApprovalReplyOutcome> {
  const button = parseApprovalButton(reply.buttonId);
  const secret = approvalSecret();
  const invalid = "this button isn't valid any more. Open Lufer.ai to decide.";
  if (!button || !secret) return refused(reply, provider, invalid);

  // Who pressed it: only approvals assigned to the user this number is linked to are looked at.
  const link = await channelStore().findLink("whatsapp", reply.from);
  if (!link) return refused(reply, provider, "this number isn't linked to a Lufer.ai approver. Ask your admin to link it in Settings → Channels, or decide in Lufer.ai.");

  const approval = (await listApprovals({ tenantId: link.companyId, approverId: link.userId })).find((a) => a.id === button.approvalId);
  // Someone else's approval, an unknown ID and a bad MAC read the same, so a guessed ID learns nothing.
  if (!approval || !verifyApprovalButton(button, approval.approver_id, secret)) return refused(reply, provider, invalid);

  const actor = (await listPortalUsers({ companyId: approval.tenant_id })).find((u) => u.id === approval.approver_id);
  if (actor?.role !== "APPROVER") return refused(reply, provider, "only users with the Approver role can sign off.");

  const subject = subjectOf(approval);
  const notified = new Set((await actionableFor(approval.tenant_id, subject)).map((a) => a.id));
  try {
    await decideApproval(approval.id, { approverId: approval.approver_id, tenantId: approval.tenant_id }, button.decision, "Decided on WhatsApp");
  } catch (err) {
    // decideApproval's messages are written for users ("Waiting for tier-1 sign-off from …").
    return refused(reply, provider, err instanceof Error ? err.message : "could not record the decision.");
  }

  let status: string | null;
  let counterpartyId: string;
  if ("bookingId" in subject) {
    const [booking] = await listBookings({ companyId: approval.tenant_id, ids: [subject.bookingId] });
    status = booking?.status ?? null;
    counterpartyId = booking?.venue_id ?? "";
  } else {
    const [order] = await listCatalogOrders({ tenantId: approval.tenant_id, ids: [subject.orderId] });
    status = order?.status ?? null;
    counterpartyId = order?.partner_id ?? "";
  }
  const next = button.decision === "REJECTED" ? "cancelled" : status === "PENDING_APPROVAL" ? "next_approver" : status ? "venue" : "none";
  return {
    reply: decisionReplyText({ ok: true, decision: button.decision, subjectName: approval.booking.venue_name, next }),
    to: reply.from,
    provider,
    decided: { approvalId: approval.id, tenantId: approval.tenant_id, subject, decision: button.decision, status, counterpartyId, notified },
  };
}

/**
 * After a press: tells the approver what happened, publishes the live events
 * /client/approvals and the portals listen for (as the web decision does), and
 * sends the next step to its approver. Never throws.
 */
export async function followUpApprovalReply(outcome: ApprovalReplyOutcome): Promise<void> {
  const jobs: Promise<unknown>[] = [
    sendWhatsAppMessage(`+${outcome.to}`, outcome.reply, outcome.provider).catch((err) => console.error("approvals: WhatsApp confirmation failed", err)),
  ];
  const d = outcome.decided;
  if (d) {
    const subjectId = "bookingId" in d.subject ? d.subject.bookingId : d.subject.orderId;
    jobs.push(
      (async () => {
        await publishApproval(d.approvalId, subjectId, d.decision);
        if (!d.status || d.status === "PENDING_APPROVAL") return;
        if ("orderId" in d.subject) await publishOrder(subjectId, d.counterpartyId, d.status as OrderEventStatus, "approval");
        else await publishBooking(subjectId, d.counterpartyId, d.status as BookingStatus, "approval", d.tenantId);
      })().catch((err) => console.error("approvals: publish failed", err))
    );
    if (d.decision === "APPROVED" && d.status === "PENDING_APPROVAL") jobs.push(notifyApprovers(d.tenantId, d.subject, d.notified));
  }
  await Promise.all(jobs);
}
