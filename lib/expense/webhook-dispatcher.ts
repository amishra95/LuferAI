/**
 * Card-transaction reconciliation webhooks: one virtual-card event (issued or
 * settled), shaped for the company's expense or ERP system and delivered
 * signed, with retries.
 *
 *   ramp     amount_in_cents, merchant_name, category, receipt_url, approval_id, card_id
 *   brex     amount (minor units), currency, merchant_descriptor, user_id, memo, card_id
 *   concur   the generic ERP payload below (ISO 4217 currency, ISO 8601 times)
 *   zoho     the same
 *   webhook  the same
 *
 * This complements the itemised receipt export (lib/finance/export-dispatcher.ts,
 * sent once a booking is confirmed): card events reconcile the spend itself.
 * As with lib/finance/expense-adapters.ts, the shapes are a mapping layer, not
 * vendor SDKs; check field names against the provider's API before go-live.
 *
 * Pure apart from the injected fetch: tests import it directly
 * (tests/expense-webhooks.test.mjs).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const CARD_SYNC_PROVIDERS = ["webhook", "ramp", "brex", "concur", "zoho"] as const;
export type CardSyncProvider = (typeof CARD_SYNC_PROVIDERS)[number];

export const isCardSyncProvider = (v: unknown): v is CardSyncProvider => typeof v === "string" && (CARD_SYNC_PROVIDERS as readonly string[]).includes(v);

export type CardEvent = "card.issued" | "card.settled";

export const ERP_SCHEMA = "lufer.erp-transaction/v1";

/** One card event, provider-neutral. Amounts in rupees (2 decimals). */
export interface CardTransaction {
  event: CardEvent;
  /** Stable per card and event, so receivers can dedupe retries. */
  transactionId: string;
  /** The issuer's card token (vc_sandbox_… today): opaque, never a card number. */
  cardId: string;
  bookingId: string;
  amountInr: number;
  currency: "INR";
  merchant: string;
  category: string;
  memo: string;
  /** Who issued the card. */
  userId: string | null;
  /** The final approval step for the booking, when it needed one. */
  approvalId: string | null;
  approvedAt: string | null;
  receiptUrl: string | null;
  invoiceUrl: string | null;
  occurredAt: string;
}

/** INR → paise, exact for 2-decimal amounts. */
export const toMinorUnits = (inr: number) => Math.round(inr * 100);

/** The JSON body for a provider. */
export function buildCardPayload(provider: CardSyncProvider, t: CardTransaction): Record<string, unknown> {
  switch (provider) {
    case "ramp":
      return {
        event: t.event,
        external_id: t.transactionId,
        amount_in_cents: toMinorUnits(t.amountInr),
        currency: t.currency,
        merchant_name: t.merchant,
        category: t.category,
        receipt_url: t.receiptUrl,
        approval_id: t.approvalId,
        card_id: t.cardId,
        transaction_date: t.occurredAt,
      };
    case "brex":
      return {
        event: t.event,
        external_id: t.transactionId,
        // Brex money amounts are integers in the currency's minor unit.
        amount: toMinorUnits(t.amountInr),
        currency: t.currency,
        merchant_descriptor: t.merchant,
        user_id: t.userId,
        memo: t.memo,
        card_id: t.cardId,
        purchased_at: t.occurredAt,
      };
    case "concur":
    case "zoho":
    case "webhook":
      return {
        schema: ERP_SCHEMA,
        event: t.event,
        transaction_id: t.transactionId,
        amount: Number(t.amountInr.toFixed(2)),
        currency: t.currency,
        merchant: t.merchant,
        invoice_url: t.invoiceUrl,
        manager_approval_timestamp: t.approvedAt,
        card_id: t.cardId,
        booking_id: t.bookingId,
        occurred_at: t.occurredAt,
      };
  }
}

// --- Signatures ---------------------------------------------------------------------------

/** X-Lufer-Signature: sha256=<hex HMAC-SHA256 of the raw body>. */
export function signPayload(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** Constant-time check of an X-Lufer-Signature header. False when either is missing. */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(signPayload(rawBody, secret));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// --- Delivery -----------------------------------------------------------------------------

/**
 * Env var names for a provider's endpoint and API token, the same ones receipt
 * exports use. The plain webhook authenticates by signature only.
 */
export function cardSyncEnv(provider: CardSyncProvider): { url: string; token: string | null } {
  if (provider === "webhook") return { url: "EXPENSE_WEBHOOK_URL", token: null };
  const p = provider.toUpperCase();
  return { url: `${p}_EXPENSE_URL`, token: `${p}_API_TOKEN` };
}

export interface DeliveryTarget {
  provider: CardSyncProvider;
  /** Empty: nothing is sent and the outcome is "mocked". */
  url: string;
  /** Sent as a bearer token when set. */
  token?: string;
  /** Signs the body (X-Lufer-Signature) when set. */
  signingSecret?: string;
}

export interface DeliveryDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Total attempts, including the first. */
  attempts?: number;
  timeoutMs?: number;
}

export interface CardSyncOutcome {
  status: "delivered" | "mocked" | "failed";
  provider: CardSyncProvider;
  event: CardEvent;
  transactionId: string;
  attempts: number;
  payloadSha256: string;
  responseCode?: number;
  error?: string;
}

/** Network errors, 429 and 5xx are worth another try; other 4xx won't change. */
const retryable = (status: number) => status === 429 || status >= 500;

/**
 * Sends one card event. Retries with backoff (0.5 s, 1 s, …) on network
 * errors, 429 and 5xx. Never throws: failures come back as status "failed".
 */
export async function deliverCardTransaction(target: DeliveryTarget, t: CardTransaction, deps: DeliveryDeps = {}): Promise<CardSyncOutcome> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = Math.max(1, deps.attempts ?? 3);
  const body = JSON.stringify(buildCardPayload(target.provider, t));
  const base = { provider: target.provider, event: t.event, transactionId: t.transactionId, payloadSha256: createHash("sha256").update(body).digest("hex") };
  if (!target.url) return { ...base, status: "mocked", attempts: 0 };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Lufer-Event": t.event,
    "X-Lufer-Payload-SHA256": base.payloadSha256,
    "Idempotency-Key": t.transactionId,
    ...(target.signingSecret && { "X-Lufer-Signature": signPayload(body, target.signingSecret) }),
    ...(target.token && { Authorization: `Bearer ${target.token}` }),
  };

  let last: Pick<CardSyncOutcome, "responseCode" | "error"> = {};
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(500 * 2 ** (attempt - 2));
    try {
      const res = await doFetch(target.url, { method: "POST", headers, body, signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000) });
      if (res.ok) return { ...base, status: "delivered", attempts: attempt, responseCode: res.status };
      last = { responseCode: res.status, error: `Receiver returned ${res.status}` };
      if (!retryable(res.status)) return { ...base, status: "failed", attempts: attempt, ...last };
    } catch (err) {
      last = { error: err instanceof Error ? err.message : "Delivery failed" };
    }
  }
  return { ...base, status: "failed", attempts: maxAttempts, ...last };
}
