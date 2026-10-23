import "server-only";

import { env } from "@/lib/channels/config";
import { sendWhatsAppText } from "@/lib/channels/whatsapp";

/**
 * Outbound WhatsApp for the concierge: the Meta Cloud API number the channel
 * integration already uses (lib/channels/whatsapp.ts), else Twilio's WhatsApp
 * sender. Meta only delivers free-form text inside the 24-hour window after the
 * recipient last messaged you; outside it, Meta requires an approved template.
 *
 * Twilio env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (+E.164).
 */
export type WhatsAppProvider = "meta" | "twilio";

export function whatsAppProvider(): WhatsAppProvider | null {
  if (env("WHATSAPP_ACCESS_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")) return "meta";
  if (env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_WHATSAPP_FROM")) return "twilio";
  return null;
}

const sendViaTwilio = (to: string, body: string) => sendTwilioWhatsApp(to, { Body: body });

/**
 * Sends a Twilio WhatsApp message to `to` (+E.164): `Body` for text, or
 * `ContentSid` + `ContentVariables` for a Content template (quick-reply
 * buttons). Returns the message SID; throws with Twilio's message on failure.
 */
export async function sendTwilioWhatsApp(to: string, fields: Record<string, string>): Promise<string> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: `whatsapp:${env("TWILIO_WHATSAPP_FROM")}`, To: `whatsapp:${to}`, ...fields }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
  if (!res.ok) throw new Error(`Twilio send failed (${res.status}): ${json?.message ?? res.statusText}`);
  return json?.sid ?? "";
}

/**
 * Sends `body` to `to` (+E.164), through `via` when given (e.g. the provider a
 * message came in on), else the configured one. Throws with the provider's message on failure.
 */
export async function sendWhatsAppMessage(to: string, body: string, via?: WhatsAppProvider): Promise<{ provider: WhatsAppProvider; messageId: string | null }> {
  const provider = via ?? whatsAppProvider();
  if (!provider) throw new Error("WhatsApp isn't configured: set the Meta Cloud API or Twilio credentials.");
  if (provider === "meta") {
    // Meta takes the number without the leading +.
    await sendWhatsAppText(to.replace(/^\+/, ""), body);
    return { provider, messageId: null };
  }
  return { provider, messageId: await sendViaTwilio(to, body) };
}
