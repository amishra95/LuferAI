import { env, isChannelConfigured } from "@/lib/channels/config";
import { dispatchReply } from "@/lib/channels/dispatch";
import { tokensMatch, verifyMetaSignature } from "@/lib/channels/signatures";
import { channelStore } from "@/lib/channels/store";
import { extractWhatsAppMessages } from "@/lib/channels/whatsapp";

export const maxDuration = 60;

/** Meta's subscription handshake: echo hub.challenge when the verify token matches. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const ok = params.get("hub.mode") === "subscribe" && tokensMatch(params.get("hub.verify_token"), env("WHATSAPP_VERIFY_TOKEN"));
  if (!ok) return new Response("Forbidden", { status: 403 });
  return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

/**
 * Inbound messages. The signature is checked over the raw body before
 * anything is parsed; each message is handed to the durable reply workflow
 * (workflows/channel-reply.ts) and acknowledged at once so Meta doesn't redeliver.
 */
export async function POST(req: Request) {
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
      if (!(await store.firstDelivery(`wa:${m.id}`))) continue;
      await dispatchReply({ senderId: m.from, text: m.text, target: { channel: "whatsapp", to: m.from } });
    }
  } catch (err) {
    // Store unavailable: a 5xx makes Meta retry later instead of dropping the message.
    console.error("whatsapp: webhook failed", err);
    return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
  }
  return new Response(null, { status: 200 });
}
