import { FatalError, RetryableError } from "workflow";

import { recordDelivery, runChannelAgent, type ChannelAgentResult } from "@/lib/channels/agent";
import { classifyDeliveryFailure } from "@/lib/channels/delivery-errors";
import { postSlackMessage } from "@/lib/channels/slack";
import { sendWhatsAppText } from "@/lib/channels/whatsapp";

/**
 * Durable reply to one inbound WhatsApp or Slack message, started by the
 * webhooks once they've verified and acknowledged it.
 *
 *   1. generate  run the channel concierge (model or deterministic parser)
 *   2. deliver   send the reply; transient failures retry with backoff
 *   3. record    mark the message log sent / failed
 *
 * Each step's result is persisted, so a crash or redeploy resumes where it
 * stopped instead of losing the message (the old `after()` path did).
 */

export type ReplyTarget = { channel: "whatsapp"; to: string } | { channel: "slack"; channelId: string; threadTs?: string };

export interface ChannelReplyInput {
  /** Fixed by the webhook so every attempt shares one message-log row. */
  eventId: string;
  senderId: string;
  text: string;
  target: ReplyTarget;
}

/** Step errors are deserialized into the workflow, so don't rely on `instanceof Error`. */
const messageOf = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err && typeof err.message === "string" ? err.message : "Reply failed";

const APOLOGY = "Sorry, something went wrong on our side. Please try again in a moment.";

export async function channelReplyWorkflow(input: ChannelReplyInput) {
  "use workflow";

  let reply: string;
  try {
    reply = (await generateReply(input)).reply;
  } catch {
    // Only reached if the step itself died (it never throws on agent errors).
    reply = APOLOGY;
  }

  try {
    await deliverReply(input.target, reply);
  } catch (err) {
    await markDelivered(input.eventId, { ok: false, error: messageOf(err) });
    return { eventId: input.eventId, delivered: false };
  }
  await markDelivered(input.eventId, { ok: true });
  return { eventId: input.eventId, delivered: true };
}

async function generateReply(input: ChannelReplyInput): Promise<ChannelAgentResult> {
  "use step";
  return runChannelAgent({ channel: input.target.channel, senderId: input.senderId, text: input.text, eventId: input.eventId });
}
// The agent can file a booking. Re-running it after a partial run could file a
// second one, so this step runs once; if it dies the workflow sends an apology.
generateReply.maxRetries = 0;

async function deliverReply(target: ReplyTarget, reply: string) {
  "use step";
  try {
    if (target.channel === "whatsapp") await sendWhatsAppText(target.to, reply);
    else await postSlackMessage(target.channelId, reply, target.threadTs);
  } catch (err) {
    throw classifyDeliveryError(err);
  }
}
deliverReply.maxRetries = 5;

async function markDelivered(eventId: string, outcome: { ok: true } | { ok: false; error: string }) {
  "use step";
  await recordDelivery(eventId, outcome);
}

function classifyDeliveryError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  switch (classifyDeliveryFailure(message)) {
    case "rate-limited":
      return new RetryableError(message, { retryAfter: "30s" });
    case "permanent":
      return new FatalError(message);
    default:
      return err instanceof Error ? err : new Error(message);
  }
}
