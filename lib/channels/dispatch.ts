import "server-only";

import { after } from "next/server";
import { start } from "workflow/api";

import { recordDelivery, runChannelAgent } from "@/lib/channels/agent";
import { postSlackMessage } from "@/lib/channels/slack";
import { sendWhatsAppText } from "@/lib/channels/whatsapp";
import { channelReplyWorkflow, type ChannelReplyInput, type ReplyTarget } from "@/workflows/channel-reply";

/**
 * Hands an acknowledged inbound message to the durable reply workflow. If the
 * workflow can't be started (runtime unavailable), replies inline after the
 * response as before, so the message is still answered, just without retries.
 */
export async function dispatchReply(message: { senderId: string; text: string; target: ReplyTarget }) {
  const input: ChannelReplyInput = { eventId: crypto.randomUUID(), ...message };
  try {
    await start(channelReplyWorkflow, [input]);
  } catch (err) {
    console.error(`${input.target.channel}: could not start reply workflow; replying inline`, err);
    after(() => replyInline(input));
  }
}

async function replyInline({ eventId, senderId, text, target }: ChannelReplyInput) {
  const result = await runChannelAgent({ channel: target.channel, senderId, text, eventId });
  try {
    if (target.channel === "whatsapp") await sendWhatsAppText(target.to, result.reply);
    else await postSlackMessage(target.channelId, result.reply, target.threadTs);
    await recordDelivery(eventId, { ok: true });
  } catch (err) {
    console.error(`${target.channel}: reply failed`, err);
    await recordDelivery(eventId, { ok: false, error: err instanceof Error ? err.message : "Reply failed" });
  }
}
