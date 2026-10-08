import { env, isChannelConfigured } from "@/lib/channels/config";
import { dispatchReply } from "@/lib/channels/dispatch";
import { handOff } from "@/lib/channels/handoff";
import { verifySlackSignature } from "@/lib/channels/signatures";
import { extractSlackMessage } from "@/lib/channels/slack";
import { channelStore } from "@/lib/channels/store";
import { tracer } from "@/lib/tracer";

export const maxDuration = 60;

/**
 * Slack Events API endpoint: URL verification and message events. Every
 * request (including the handshake) must carry a valid signature. Slack wants
 * a 200 within 3 seconds, so the reply runs in the durable reply workflow
 * (workflows/channel-reply.ts) after the ack.
 */
async function handleSlack(req: Request) {
  if (!isChannelConfigured("slack")) return Response.json({ error: "Slack is not configured." }, { status: 503 });

  const raw = await req.text();
  const signed = verifySlackSignature(
    raw,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
    env("SLACK_SIGNING_SECRET")
  );
  if (!signed) return Response.json({ error: "Invalid signature." }, { status: 401 });

  let payload: { type?: string; challenge?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (payload.type === "url_verification") return Response.json({ challenge: payload.challenge });

  // Slack retries (x-slack-retry-num) are processed like first deliveries: the
  // receipt check drops the ones already handed off, and lets through the ones
  // we answered with a 503.
  const store = channelStore();
  try {
    if (!(await store.isEnabled("slack"))) return new Response(null, { status: 200 });

    const msg = extractSlackMessage(payload);
    if (msg) {
      await handOff(store, `slack:${msg.eventId}`, () =>
        dispatchReply({ senderId: msg.user, text: msg.text, target: { channel: "slack", channelId: msg.channel, threadTs: msg.threadTs } })
      );
    }
  } catch (err) {
    // Store unavailable: a 5xx makes Slack retry instead of dropping the event.
    console.error("slack: webhook failed", err);
    return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
  }
  return new Response(null, { status: 200 });
}

export const POST = tracer.traceResponse("webhook.slack", handleSlack);
