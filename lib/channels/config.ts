import "server-only";

import type { ChannelId } from "@/types/channels";

/** Env vars each channel needs; Settings → Channels shows which are set. */
export const CHANNEL_ENV = {
  whatsapp: [
    { key: "WHATSAPP_VERIFY_TOKEN", label: "Verify token", hint: "Any string you choose; paste the same value into Meta's webhook settings.", secret: true },
    { key: "WHATSAPP_APP_SECRET", label: "App secret", hint: "Meta app → Settings → Basic. Verifies X-Hub-Signature-256.", secret: true },
    { key: "WHATSAPP_ACCESS_TOKEN", label: "Access token", hint: "System-user token with whatsapp_business_messaging.", secret: true },
    { key: "WHATSAPP_PHONE_NUMBER_ID", label: "Phone number ID", hint: "WhatsApp → API setup. Replies are sent from this number.", secret: false },
  ],
  slack: [
    { key: "SLACK_SIGNING_SECRET", label: "Signing secret", hint: "Slack app → Basic Information. Verifies X-Slack-Signature.", secret: true },
    { key: "SLACK_BOT_TOKEN", label: "Bot token", hint: "xoxb-… with chat:write, app_mentions:read, im:history.", secret: true },
  ],
} as const satisfies Record<ChannelId, readonly { key: string; label: string; hint: string; secret: boolean }[]>;

export type ChannelEnvKey = (typeof CHANNEL_ENV)[ChannelId][number]["key"];

export const env = (key: string) => (process.env[key] ?? "").trim();

export const isChannelConfigured = (c: ChannelId) => CHANNEL_ENV[c].every((f) => env(f.key));
