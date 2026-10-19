/**
 * Dropbox Sign (formerly HelloSign) adapter: send a signature request, cancel
 * it, and verify + read its event callbacks. https://developers.hellosign.com/api/reference/
 *
 * Callbacks are authenticated by `event_hash` = HMAC-SHA256(api key,
 * event_time + event_type). That proves the sender but doesn't cover the body,
 * so the receiver re-fetches the signature request from the API and acts on
 * what the API says, never on the callback's copy.
 *
 * Signers are sent in order: 0 = the client's signatory, 1 = the venue's. A
 * callback's signatures map back to parties by that order.
 *
 * No server-only imports and `fetch` is injected: tests drive it with fixtures
 * (tests/contracts.test.mjs). Not yet exercised against a live account.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const API_BASE = "https://api.hellosign.com/v3";
/** The body Dropbox Sign expects back, or it retries the callback. */
export const CALLBACK_ACK = "Hello API Event Received";

export class DropboxSignError extends Error {}
export class CallbackVerificationError extends Error {}

type Fetch = typeof fetch;

const auth = (apiKey: string) => `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

async function call<T>(fetchImpl: Fetch, apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchImpl(`${API_BASE}${path}`, { ...init, headers: { Authorization: auth(apiKey), ...(init.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as { error?: { error_msg?: string } } & T;
  if (!res.ok) throw new DropboxSignError(`Dropbox Sign ${path} failed: ${json.error?.error_msg ?? res.status}`);
  return json;
}

export interface ProviderSignature {
  signatureId: string;
  /** 0 = client, 1 = venue. */
  order: number;
  name: string;
  email: string;
  /** awaiting_signature | signed | declined | … */
  status: string;
  /** ISO, when signed. */
  signedAt: string | null;
}

export interface ProviderRequest {
  requestId: string;
  contractId: string | null;
  isComplete: boolean;
  isDeclined: boolean;
  signatures: ProviderSignature[];
}

type RawSignature = { signature_id: string; order: number | null; signer_name: string; signer_email_address: string; status_code: string; signed_at: number | null };
type RawRequest = { signature_request_id: string; metadata?: Record<string, string> | null; is_complete?: boolean; is_declined?: boolean; signatures?: RawSignature[] };

function toRequest(r: RawRequest): ProviderRequest {
  return {
    requestId: r.signature_request_id,
    contractId: r.metadata?.contract_id ?? null,
    isComplete: Boolean(r.is_complete),
    isDeclined: Boolean(r.is_declined),
    signatures: (r.signatures ?? []).map((s, i) => ({
      signatureId: s.signature_id,
      order: s.order ?? i,
      name: s.signer_name,
      email: s.signer_email_address,
      status: s.status_code,
      signedAt: s.signed_at ? new Date(s.signed_at * 1000).toISOString() : null,
    })),
  };
}

export interface SendInput {
  apiKey: string;
  fetch?: Fetch;
  title: string;
  subject: string;
  message: string;
  /** In signing order: the client's signatory first, then the venue's. */
  signers: { name: string; email: string }[];
  fileName: string;
  html: string;
  contractId: string;
  testMode: boolean;
}

export async function sendSignatureRequest(input: SendInput): Promise<ProviderRequest> {
  const form = new FormData();
  form.set("title", input.title);
  form.set("subject", input.subject);
  form.set("message", input.message);
  input.signers.forEach((s, i) => {
    form.set(`signers[${i}][name]`, s.name);
    form.set(`signers[${i}][email_address]`, s.email);
    form.set(`signers[${i}][order]`, String(i));
  });
  form.set("files[0]", new Blob([input.html], { type: "text/html" }), input.fileName);
  form.set("metadata[contract_id]", input.contractId);
  form.set("test_mode", input.testMode ? "1" : "0");
  const res = await call<{ signature_request: RawRequest }>(input.fetch ?? fetch, input.apiKey, "/signature_request/send", { method: "POST", body: form });
  return toRequest(res.signature_request);
}

export async function getSignatureRequest(apiKey: string, requestId: string, fetchImpl: Fetch = fetch): Promise<ProviderRequest> {
  const res = await call<{ signature_request: RawRequest }>(fetchImpl, apiKey, `/signature_request/${encodeURIComponent(requestId)}`);
  return toRequest(res.signature_request);
}

export async function cancelSignatureRequest(apiKey: string, requestId: string, fetchImpl: Fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${API_BASE}/signature_request/cancel/${encodeURIComponent(requestId)}`, { method: "POST", headers: { Authorization: auth(apiKey) } });
  // 410: already complete, declined or cancelled; nothing left to cancel.
  if (!res.ok && res.status !== 410) throw new DropboxSignError(`Dropbox Sign cancel failed: ${res.status}`);
}

// ----------------------------------------------------------------------------
// Callbacks
// ----------------------------------------------------------------------------

export type CallbackKind = "signed" | "all_signed" | "declined" | "canceled" | "test" | "other";

export interface CallbackEvent {
  /** Stable per event, for idempotency. */
  eventId: string;
  type: string;
  kind: CallbackKind;
  requestId: string | null;
  /** The signature the event is about (signed / declined). */
  signatureId: string | null;
  payload: unknown;
}

const KIND: Record<string, CallbackKind> = {
  signature_request_signed: "signed",
  signature_request_all_signed: "all_signed",
  signature_request_declined: "declined",
  signature_request_canceled: "canceled",
  callback_test: "test",
};

export function eventHash(apiKey: string, eventTime: string, eventType: string): string {
  return createHmac("sha256", apiKey).update(eventTime + eventType).digest("hex");
}

/**
 * Reads the callback's `json` field (multipart form or raw JSON) and verifies its
 * event_hash with the account's API key. Throws CallbackVerificationError.
 */
export function verifyCallback(json: string, apiKey: string): CallbackEvent {
  let body: { event?: { event_time?: string; event_type?: string; event_hash?: string; event_metadata?: { related_signature_id?: string | null } }; signature_request?: RawRequest };
  try {
    body = JSON.parse(json);
  } catch {
    throw new CallbackVerificationError("Callback body is not JSON");
  }
  const e = body.event;
  if (!e?.event_time || !e.event_type || !e.event_hash) throw new CallbackVerificationError("Callback has no event");
  const expected = Buffer.from(eventHash(apiKey, e.event_time, e.event_type));
  const got = Buffer.from(String(e.event_hash));
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new CallbackVerificationError("Bad event_hash");

  const requestId = body.signature_request?.signature_request_id ?? null;
  const signatureId = e.event_metadata?.related_signature_id ?? null;
  return {
    eventId: [requestId ?? "none", e.event_type, e.event_time, signatureId ?? ""].join(":"),
    type: e.event_type,
    kind: KIND[e.event_type] ?? "other",
    requestId,
    signatureId,
    payload: body,
  };
}

export type ProviderUpdate =
  | { kind: "sign"; party: "client" | "venue"; signature: ProviderSignature }
  | { kind: "decline"; party: "client" | "venue"; signer: string }
  | { kind: "cancel" };

/**
 * What the API's view of a request means for our contract, in order: signatures
 * not yet recorded (client before venue), then a decline or cancellation.
 * `recorded` lists the parties already signed on our side.
 */
export function updatesFrom(request: ProviderRequest, recorded: readonly ("client" | "venue")[], event: Pick<CallbackEvent, "kind">): ProviderUpdate[] {
  const party = (s: ProviderSignature) => (s.order === 0 ? "client" : "venue") as "client" | "venue";
  const out: ProviderUpdate[] = request.signatures
    .filter((s) => s.status === "signed" && (s.order === 0 || s.order === 1) && !recorded.includes(party(s)))
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ kind: "sign", party: party(s), signature: s }));
  const declined = request.signatures.find((s) => s.status === "declined");
  if (request.isDeclined && declined) out.push({ kind: "decline", party: party(declined), signer: declined.name });
  else if (event.kind === "canceled") out.push({ kind: "cancel" });
  return out;
}
