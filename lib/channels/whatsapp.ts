import "server-only";

import { env } from "@/lib/channels/config";

/** Graph API version for outbound sends; override when Meta deprecates it. */
const graphVersion = () => env("WHATSAPP_GRAPH_VERSION") || "v23.0";

export type WhatsAppInbound = { id: string; from: string; text: string };

type WebhookPayload = {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: { messages?: { id?: string; from?: string; type?: string; text?: { body?: string } }[] };
    }[];
  }[];
};

/** Text messages from a Cloud API webhook. Status updates, media and reactions are skipped. */
export function extractWhatsAppMessages(payload: unknown): WhatsAppInbound[] {
  const p = payload as WebhookPayload;
  if (p?.object !== "whatsapp_business_account") return [];
  return (p.entry ?? []).flatMap((e) =>
    (e.changes ?? [])
      .filter((c) => c.field === "messages")
      .flatMap((c) => c.value?.messages ?? [])
      .filter((m) => m.type === "text" && m.id && m.from && m.text?.body?.trim())
      .map((m) => ({ id: m.id!, from: m.from!, text: m.text!.body!.trim() }))
  );
}

/** Sends a text reply through the WhatsApp Cloud API. Throws with Meta's error message on failure. */
export async function sendWhatsAppText(to: string, body: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${graphVersion()}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4096), preview_url: false } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`WhatsApp send failed (${res.status}): ${detail?.error?.message ?? res.statusText}`);
  }
}
