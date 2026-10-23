/**
 * Zero-login quote links for venue managers: the signed token. Pure (no server
 * imports) so tests/vendor/*.test.mjs can exercise it; lib/vendor/quote-service.ts
 * loads and answers the RFP behind a link, and lib/vendor/quote-form.ts checks the form.
 *
 * A link's token is `q1.<rfp response id>.<venue id>.<expiry, unix seconds>.<mac>`,
 * the MAC an HMAC-SHA256 (VENDOR_LINK_SECRET) over the rest. It opens one
 * venue's response to one RFP until it expires, and only while the RFP is open.
 * Nothing is stored: rotating VENDOR_LINK_SECRET revokes every link.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "q1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** How long a link works. RFPs are usually decided within days; a fresh link is sent with each one. */
export const QUOTE_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

const mac = (body: string, secret: string) => createHmac("sha256", secret).update(`vendor-quote:${body}`, "utf8").digest("base64url");

/** A link token for `venueId`'s response `responseId`, valid for `ttlSeconds` from `nowSeconds`. */
export function signQuoteToken(
  scope: { responseId: string; venueId: string },
  secret: string,
  { nowSeconds = Math.floor(Date.now() / 1000), ttlSeconds = QUOTE_LINK_TTL_SECONDS }: { nowSeconds?: number; ttlSeconds?: number } = {}
): string {
  if (!secret) throw new Error("VENDOR_LINK_SECRET is not set.");
  const body = `${PREFIX}.${scope.responseId.toLowerCase()}.${scope.venueId.toLowerCase()}.${nowSeconds + ttlSeconds}`;
  return `${body}.${mac(body, secret)}`;
}

export type QuoteTokenCheck =
  | { ok: true; responseId: string; venueId: string; expiresAt: number }
  | { ok: false; reason: "unconfigured" | "malformed" | "bad_signature" | "expired" };

/**
 * Checks a token: shape, then MAC, then expiry, so an expired link is only
 * reported as expired when it's genuine.
 */
export function verifyQuoteToken(token: string | null | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): QuoteTokenCheck {
  if (!secret) return { ok: false, reason: "unconfigured" };
  const parts = (token ?? "").split(".");
  if (parts.length !== 5 || parts[0] !== PREFIX || !UUID.test(parts[1]) || !UUID.test(parts[2]) || !/^\d{1,12}$/.test(parts[3])) return { ok: false, reason: "malformed" };
  const given = Buffer.from(parts[4]);
  const expected = Buffer.from(mac(parts.slice(0, 4).join("."), secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  const expiresAt = Number(parts[3]);
  if (expiresAt <= nowSeconds) return { ok: false, reason: "expired" };
  return { ok: true, responseId: parts[1], venueId: parts[2], expiresAt };
}
