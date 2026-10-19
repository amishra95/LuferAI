import "server-only";

import { after } from "next/server";

import { postSlackMessage } from "@/lib/channels/slack";
import { sendWhatsAppText } from "@/lib/channels/whatsapp";
import { alertText, type AlertSubject, type EscalationStatus } from "@/lib/escalations/rules";
import { getEscalation, recordEvent, SYSTEM, venueAlertNumber, type Escalation } from "@/lib/escalations/store";
import { siteUrl } from "@/lib/site-url";
import { publishEscalation } from "@/lib/telemetry/live";

/**
 * Tells people about an escalation, and records each attempt in its audit trail:
 *
 *   in-app     always: a live telemetry event, so /agents and the venue's
 *              /property refresh and show the queue (lib/telemetry/refresh.ts)
 *   Slack      when ESCALATIONS_SLACK_CHANNEL and SLACK_BOT_TOKEN are set
 *   WhatsApp   new escalations only, to the number the host set for alerts,
 *              when the WhatsApp Cloud API is configured. Meta only delivers
 *              free-form text within 24 h of the host's last message to the
 *              business number; outside that window the send fails and the
 *              trail says so (a template message would be needed).
 *
 * Runs after the response (next/server after()); never throws.
 */

const env = (k: string) => process.env[k]?.trim() ?? "";

const subject = (e: Escalation): AlertSubject => ({
  venue: e.venueName,
  company: e.companyName,
  partySize: e.partySize,
  eventDate: e.rfp.eventDate,
  proposedPerHead: e.proposedPerHead,
  standardPerHead: e.standardPerHead,
  reason: e.reason,
});

async function deliver(escalationId: string, channel: string, send: () => Promise<void>) {
  try {
    await send();
    await recordEvent(escalationId, "notified", SYSTEM, { channel });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`escalations: ${channel} notification failed for ${escalationId}`, err);
    await recordEvent(escalationId, "notify_failed", SYSTEM, { channel, error: error.slice(0, 300) });
  }
}

async function run(escalationId: string, kind: "opened" | "decided", by?: string) {
  const e = await getEscalation(escalationId).catch((err) => {
    console.error(`escalations: could not load ${escalationId} to notify`, err);
    return null;
  });
  if (!e) return;
  await deliver(e.id, "in-app", () => publishEscalation(e.id, e.venueId, e.status));

  const link = `${siteUrl("http://localhost:3000")}${kind === "opened" ? "/property?tab=requests#escalations" : "/agents#escalations"}`;
  const text =
    kind === "opened" ? alertText("opened", subject(e), link) : alertText("decided", subject(e), link, { status: e.status as EscalationStatus, perHead: e.decidedPerHead, by: by ?? "a reviewer" });

  const jobs: Promise<void>[] = [];
  const slackChannel = env("ESCALATIONS_SLACK_CHANNEL");
  if (slackChannel && env("SLACK_BOT_TOKEN")) jobs.push(deliver(e.id, "slack", () => postSlackMessage(slackChannel, text)));
  if (kind === "opened" && env("WHATSAPP_ACCESS_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")) {
    const to = await venueAlertNumber(e.venueId);
    // Graph API numbers have no leading +.
    if (to) jobs.push(deliver(e.id, "whatsapp", () => sendWhatsAppText(to.replace(/^\+/, ""), text)));
  }
  await Promise.all(jobs);
}

/** Schedules the notifications for an escalation that was opened or decided. */
export function notifyEscalation(escalationId: string, kind: "opened" | "decided", by?: string): void {
  const work = run(escalationId, kind, by).catch((err) => console.error("escalations: notification run failed", err));
  try {
    after(work);
  } catch {
    // Outside a request (tests, scripts): the promise still runs.
  }
}
