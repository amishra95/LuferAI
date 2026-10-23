/**
 * Webhook signature checks for Meta (WhatsApp) and Slack. Pure functions with
 * no server/framework imports so tests/channels.test.mjs can exercise them.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta signs the raw body: X-Hub-Signature-256: sha256=<hex HMAC with the app secret>. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return safeEqual(header, expected);
}

/** Slack allows 5 minutes of clock skew before treating a request as a replay. */
export const SLACK_MAX_SKEW_SECONDS = 60 * 5;

/**
 * Slack signs `v0:<timestamp>:<raw body>` with the signing secret:
 * X-Slack-Signature: v0=<hex>. Rejects stale timestamps to block replays.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  signingSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!timestamp || !signature || !signingSecret || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > SLACK_MAX_SKEW_SECONDS) return false;
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`, "utf8").digest("hex")}`;
  return safeEqual(signature, expected);
}

/**
 * Twilio signs the full callback URL followed by each POST parameter's name
 * and value, sorted by name: X-Twilio-Signature = base64(HMAC-SHA1(auth token)).
 * `url` must be exactly the URL configured in Twilio (scheme, host, path, query).
 */
export function verifyTwilioSignature(url: string, params: URLSearchParams, header: string | null, authToken: string): boolean {
  if (!header || !authToken || !url) return false;
  const signed = [...params.entries()]
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .reduce((acc, [k, v]) => acc + k + v, url);
  return safeEqual(header, createHmac("sha1", authToken).update(signed, "utf8").digest("base64"));
}

/** Constant-time compare for Meta's GET verification token. */
export function tokensMatch(given: string | null, expected: string): boolean {
  return Boolean(given && expected) && safeEqual(given!, expected);
}
