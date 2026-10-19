/**
 * Human-in-the-loop escalations (negotiation_escalations, migration 0029): an
 * automatic counter the platform's escalation thresholds held back, waiting
 * for the venue host or an admin. The pure parts: what a decision may be, the
 * status it leads to, and the alert text sent to Slack and WhatsApp.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/model-routing-escalations.test.mjs).
 */

export const ESCALATION_STATUSES = ["open", "approved", "modified", "rejected", "superseded"] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export const ESCALATION_ACTIONS = ["opened", "approved", "modified", "rejected", "superseded", "reopened", "notified", "notify_failed"] as const;
export type EscalationAction = (typeof ESCALATION_ACTIONS)[number];

export const STATUS_LABEL: Record<EscalationStatus, string> = {
  open: "Awaiting review",
  approved: "Approved",
  modified: "Sent at a new price",
  rejected: "Rejected",
  superseded: "Superseded",
};

/**
 * approve  send the held-back counter as proposed
 * modify   send a counter at another per-head price
 * reject   don't counter: the instant quote stands
 */
export type Decision = { action: "approve"; note: string | null } | { action: "modify"; perHead: number; note: string | null } | { action: "reject"; note: string | null };

export const NOTE_MAX = 280;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseDecision(input: { action: unknown; perHead?: unknown; note?: unknown }): Result<Decision> {
  const note = typeof input.note === "string" ? input.note.trim().slice(0, NOTE_MAX) || null : null;
  switch (input.action) {
    case "approve":
      return { ok: true, value: { action: "approve", note } };
    case "reject":
      return { ok: true, value: { action: "reject", note } };
    case "modify": {
      const raw = typeof input.perHead === "string" ? Number(input.perHead.replace(/[₹,\s]/g, "")) : input.perHead;
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > 100_000) return { ok: false, error: "Enter the per-head price to send (₹1 – ₹1,00,000)." };
      return { ok: true, value: { action: "modify", perHead: Math.round(raw * 100) / 100, note } };
    }
    default:
      return { ok: false, error: "Choose approve, modify or reject." };
  }
}

export const statusFor = (d: Decision): Exclude<EscalationStatus, "open" | "superseded"> => (d.action === "approve" ? "approved" : d.action === "modify" ? "modified" : "rejected");

/** The per-head price a decision sends, or null when it sends nothing. */
export const priceFor = (d: Decision, proposed: number): number | null => (d.action === "approve" ? proposed : d.action === "modify" ? d.perHead : null);

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export interface AlertSubject {
  venue: string;
  company: string;
  partySize: number;
  eventDate: string | null;
  proposedPerHead: number;
  standardPerHead: number | null;
  reason: string;
}

/** Plain text for Slack and WhatsApp (no markup beyond *bold*, which both render). */
export function alertText(kind: "opened", s: AlertSubject, link: string): string;
export function alertText(kind: "decided", s: AlertSubject, link: string, decision: { status: EscalationStatus; perHead: number | null; by: string }): string;
export function alertText(kind: "opened" | "decided", s: AlertSubject, link: string, decision?: { status: EscalationStatus; perHead: number | null; by: string }): string {
  const event = `${s.company} · ${s.partySize} guests${s.eventDate ? ` · ${s.eventDate}` : ""}`;
  if (kind === "opened") {
    const off = s.standardPerHead ? ` (${((1 - s.proposedPerHead / s.standardPerHead) * 100).toFixed(1)}% off ${inr(s.standardPerHead)})` : "";
    return [`*Counter-offer needs review* at ${s.venue}`, event, `Proposed ${inr(s.proposedPerHead)}/head${off}. ${s.reason}`, `Review: ${link}`].join("\n");
  }
  const what = decision!.status === "rejected" ? "rejected; the instant quote stands" : decision!.status === "superseded" ? "superseded by a manual response" : `sent at ${inr(decision!.perHead ?? s.proposedPerHead)}/head`;
  return [`*Escalated counter ${decision!.status}* at ${s.venue}`, event, `Counter ${what} by ${decision!.by}.`, link].join("\n");
}

/**
 * A WhatsApp number from the host's form, as E.164. Ten digits are read as an
 * Indian mobile (+91); otherwise the number must start with + and a country code.
 */
export function parseWhatsAppNumber(text: string): Result<string | null> {
  const t = text.trim().replace(/[\s()-]/g, "");
  if (t === "") return { ok: true, value: null };
  const e164 = /^\d{10}$/.test(t) ? `+91${t}` : /^0\d{10}$/.test(t) ? `+91${t.slice(1)}` : t;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return { ok: false, error: "Enter a WhatsApp number with its country code, e.g. +91 98450 12345." };
  return { ok: true, value: e164 };
}
