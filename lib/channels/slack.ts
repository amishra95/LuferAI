import "server-only";

import { env } from "@/lib/channels/config";

export type SlackInbound = { eventId: string; user: string; text: string; channel: string; threadTs?: string };

type EventCallback = {
  type?: string;
  event_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    thread_ts?: string;
  };
};

/**
 * The message to answer, if any: @mentions anywhere, and direct messages to
 * the bot. Bot messages and edits/joins (subtypes) are ignored so the bot
 * never answers itself.
 */
export function extractSlackMessage(payload: unknown): SlackInbound | null {
  const p = payload as EventCallback;
  const e = p?.event;
  if (p?.type !== "event_callback" || !e || !p.event_id || e.bot_id || e.subtype || !e.user || !e.channel) return null;
  const isMention = e.type === "app_mention";
  const isDm = e.type === "message" && e.channel_type === "im";
  if (!isMention && !isDm) return null;
  const text = (e.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!text) return null;
  // Mentions in channels are answered in a thread; DMs inline.
  return { eventId: p.event_id, user: e.user, text, channel: e.channel, threadTs: isMention ? (e.thread_ts ?? e.ts) : e.thread_ts };
}

/** Posts a reply with chat.postMessage. Slack returns 200 with ok:false on errors, so check the body. */
export async function postSlackMessage(channel: string, text: string, threadTs?: string): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("SLACK_BOT_TOKEN")}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, ...(threadTs && { thread_ts: threadTs }), unfurl_links: false }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(`Slack post failed: ${body?.error ?? res.status}`);
}
