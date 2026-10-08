/**
 * Whether a failed WhatsApp/Slack send is worth retrying. Pure, so it's unit
 * tested (tests/channels.test.mjs); workflows/channel-reply.ts maps it to the
 * Workflow error types.
 *
 * - "rate-limited": 429 / Slack `ratelimited` → retry after a pause
 * - "permanent":    other 4xx, bad credentials, unknown or archived channels → stop
 * - "transient":    anything else (5xx, network) → retry with backoff
 */
export type DeliveryFailure = "rate-limited" | "permanent" | "transient";

const PERMANENT_SLACK = /\b(invalid_auth|not_authed|account_inactive|token_revoked|channel_not_found|not_in_channel|is_archived|missing_scope)\b/;

export function classifyDeliveryFailure(message: string): DeliveryFailure {
  const status = Number(/\((\d{3})\)/.exec(message)?.[1]);
  if (status === 429 || /\bratelimited\b/.test(message)) return "rate-limited";
  if ((status >= 400 && status < 500) || PERMANENT_SLACK.test(message)) return "permanent";
  return "transient";
}
