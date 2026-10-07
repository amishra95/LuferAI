import { after } from "next/server";

import { runChannelAgent } from "@/lib/channels/agent";
import { env, isChannelConfigured } from "@/lib/channels/config";
import { verifySlackSignature } from "@/lib/channels/signatures";
import { extractSlackMessage, postSlackMessage } from "@/lib/channels/slack";
import { firstDelivery, isChannelEnabled, updateEvent } from "@/lib/channels/store";

export const maxDuration = 60;

/**
 * Slack Events API endpoint: URL verification and message events. Every
 * request (including the handshake) must carry a valid signature. Slack wants
 * a 200 within 3 seconds, so the agent runs after the response.
 */
export async function POST(req: Request) {
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

  // Slack retries on slow acks; the first delivery is already being handled.
  if (req.headers.get("x-slack-retry-num")) return new Response(null, { status: 200 });
  if (!isChannelEnabled("slack")) return new Response(null, { status: 200 });

  const msg = extractSlackMessage(payload);
  if (msg && firstDelivery(`slack:${msg.eventId}`)) {
    after(async () => {
      const result = await runChannelAgent({ channel: "slack", senderId: msg.user, text: msg.text });
      try {
        await postSlackMessage(msg.channel, result.reply, msg.threadTs);
      } catch (err) {
        console.error("slack: reply failed", err);
        updateEvent(result.eventId, { status: "failed", error: err instanceof Error ? err.message : "Reply failed" });
      }
    });
  }
  return new Response(null, { status: 200 });
}
