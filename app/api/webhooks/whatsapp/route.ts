import { after } from "next/server";

import { runChannelAgent } from "@/lib/channels/agent";
import { env, isChannelConfigured } from "@/lib/channels/config";
import { tokensMatch, verifyMetaSignature } from "@/lib/channels/signatures";
import { firstDelivery, isChannelEnabled, updateEvent } from "@/lib/channels/store";
import { extractWhatsAppMessages, sendWhatsAppText } from "@/lib/channels/whatsapp";

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
 * anything is parsed; the reply is generated and sent after the 200 so Meta
 * doesn't time out and redeliver.
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

  // Acknowledge but drop messages while the channel is paused.
  if (!isChannelEnabled("whatsapp")) return new Response(null, { status: 200 });

  for (const m of extractWhatsAppMessages(payload)) {
    if (!firstDelivery(`wa:${m.id}`)) continue;
    after(async () => {
      const result = await runChannelAgent({ channel: "whatsapp", senderId: m.from, text: m.text });
      try {
        await sendWhatsAppText(m.from, result.reply);
      } catch (err) {
        console.error("whatsapp: reply failed", err);
        updateEvent(result.eventId, { status: "failed", error: err instanceof Error ? err.message : "Reply failed" });
      }
    });
  }
  return new Response(null, { status: 200 });
}
