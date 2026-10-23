import { after } from "next/server";

import { decideFromWhatsApp, followUpApprovalReply, type ApprovalReplyOutcome } from "@/lib/approvals/whatsapp";
import { extractApprovalReplies, extractTwilioApprovalReply } from "@/lib/approvals/whatsapp-buttons";
import { env, isChannelConfigured } from "@/lib/channels/config";
import { dispatchReply } from "@/lib/channels/dispatch";
import { handOff } from "@/lib/channels/handoff";
import { tokensMatch, verifyMetaSignature, verifyTwilioSignature } from "@/lib/channels/signatures";
import { channelStore } from "@/lib/channels/store";
import { extractWhatsAppMessages } from "@/lib/channels/whatsapp";
import { tracer } from "@/lib/tracer";

export const maxDuration = 300; // Seconds: Gemini agent runs can take minutes (Vercel Hobby allows up to 300)

/** Meta's subscription handshake: echo hub.challenge when the verify token matches. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const ok = params.get("hub.mode") === "subscribe" && tokensMatch(params.get("hub.verify_token"), env("WHATSAPP_VERIFY_TOKEN"));
  if (!ok) return new Response("Forbidden", { status: 403 });
  return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** The approver's confirmation, live events and the next step's request go out after the ack. */
function followUp(outcome: ApprovalReplyOutcome) {
  const work = followUpApprovalReply(outcome);
  try {
    after(work);
  } catch {
    // Outside a request (tests, scripts): the promise still runs.
  }
}

/**
 * Inbound messages. The signature is checked over the raw body before
 * anything is parsed. Text messages go to the durable reply workflow
 * (workflows/channel-reply.ts); [Approve] / [Reject] presses decide the
 * approval (lib/approvals/whatsapp.ts). Both are acknowledged at once so Meta
 * doesn't redeliver. Twilio callbacks (form-encoded, X-Twilio-Signature) carry
 * approval presses only.
 */
async function handleWhatsApp(req: Request) {
  if (req.headers.has("x-twilio-signature")) return handleTwilio(req);
  if (!isChannelConfigured("whatsapp")) return Response.json({ error: "WhatsApp is not configured." }, { status: 503 });

  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), env("WHATSAPP_APP_SECRET"))) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const store = channelStore();
  try {
    // Acknowledge but drop messages while the channel is paused.
    if (!(await store.isEnabled("whatsapp"))) return new Response(null, { status: 200 });

    for (const m of extractWhatsAppMessages(payload)) {
      await handOff(store, `wa:${m.id}`, () => dispatchReply({ senderId: m.from, text: m.text, target: { channel: "whatsapp", to: m.from } }));
    }
    for (const r of extractApprovalReplies(payload)) {
      await handOff(store, `wa:${r.id}`, async () => followUp(await decideFromWhatsApp(r, "meta")));
    }
  } catch (err) {
    // Store unavailable: a 5xx makes Meta retry later instead of dropping the message.
    console.error("whatsapp: webhook failed", err);
    return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
  }
  return new Response(null, { status: 200 });
}

/**
 * Twilio's WhatsApp callback. Twilio signs the URL it was configured with:
 * TWILIO_WEBHOOK_URL when the public URL differs from what this request sees
 * (a proxy or tunnel), else the request URL.
 */
async function handleTwilio(req: Request) {
  const authToken = env("TWILIO_AUTH_TOKEN");
  if (!authToken) return Response.json({ error: "Twilio is not configured." }, { status: 503 });

  const params = new URLSearchParams(await req.text());
  if (!verifyTwilioSignature(env("TWILIO_WEBHOOK_URL") || req.url, params, req.headers.get("x-twilio-signature"), authToken)) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  const store = channelStore();
  try {
    if (!(await store.isEnabled("whatsapp"))) return new Response(null, { status: 200 });
    const r = extractTwilioApprovalReply(params);
    if (r) await handOff(store, `twilio:${r.id}`, async () => followUp(await decideFromWhatsApp(r, "twilio")));
  } catch (err) {
    console.error("whatsapp: Twilio webhook failed", err);
    return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
  }
  // An empty TwiML response: no auto-reply from Twilio.
  return new Response("<Response/>", { status: 200, headers: { "Content-Type": "text/xml" } });
}

export const POST = tracer.traceResponse("webhook.whatsapp", handleWhatsApp);
