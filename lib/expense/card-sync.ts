import "server-only";

import { after } from "next/server";

import { dataSource, findExpenseExport, listApprovals, listBookings, listCompanies } from "@/lib/data";
import { exportBookingExpense, type DispatchOutcome } from "@/lib/finance/export-dispatcher";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VirtualCard } from "@/lib/supabase/database.types";
import {
  cardSyncEnv,
  deliverCardTransaction,
  isCardSyncProvider,
  type CardEvent,
  type CardSyncOutcome,
  type CardSyncProvider,
  type CardTransaction,
} from "@/lib/expense/webhook-dispatcher";

/**
 * Card events → the company's expense / ERP system (lib/expense/webhook-dispatcher.ts).
 *
 *   card.issued   when a virtual card is created (lib/finance/virtual-cards.ts), queued after the response
 *   card.settled  when the issuer reports the charge (POST /api/webhooks/expense)
 *
 * The provider is companies.expense_provider unless the caller names one. The
 * endpoint and token come from env (`<PROVIDER>_EXPENSE_URL`, `<PROVIDER>_API_TOKEN`,
 * `EXPENSE_WEBHOOK_URL`); every body is signed with EXPENSE_WEBHOOK_SECRET when
 * set. Without an endpoint the event is logged as mocked. Never throws.
 */

const env = (k: string | null) => (k ? (process.env[k] ?? "").trim() : "");

const RECEIPT_READY = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);

function audit(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ audit: "card_expense_sync", at: new Date().toISOString(), ...entry }));
}

async function buildTransaction(card: VirtualCard, event: CardEvent, opts: { amountInr?: number; occurredAt?: string }): Promise<{ txn: CardTransaction; companyProvider: unknown }> {
  const [[booking], companies, approvals, receipt] = await Promise.all([
    listBookings({ ids: [card.booking_id] }),
    listCompanies(),
    listApprovals({ tenantId: card.tenant_id, status: "APPROVED" }),
    findExpenseExport(card.booking_id, "booking.confirmed"),
  ]);
  if (!booking) throw new Error(`Booking ${card.booking_id} not found`);
  // The last sign-off on the booking, if it went through the approval chain.
  const approval = approvals.filter((a) => a.booking_id === card.booking_id && a.decided_at).sort((a, b) => b.decided_at!.localeCompare(a.decided_at!))[0];
  // The exported receipt carries the GST invoice; it exists once the booking is confirmed.
  const receiptUrl = receipt && receipt.status !== "failed" ? `${siteUrl("")}/api/exports/${receipt.id}` : null;
  return {
    companyProvider: companies.find((c) => c.id === card.tenant_id)?.expense_provider,
    txn: {
      event,
      transactionId: `${card.id}:${event}`,
      cardId: card.card_token,
      bookingId: booking.id,
      amountInr: opts.amountInr ?? Number(card.amount_limit_inr),
      currency: "INR",
      merchant: booking.venue.name,
      category: "Corporate events",
      memo: `Corporate event · ${booking.venue.name} · ${booking.event_date} · ${booking.party_size} guests${booking.cost_center ? ` · ${booking.cost_center}` : ""}`,
      userId: card.issued_by,
      approvalId: approval?.id ?? null,
      approvedAt: approval?.decided_at ?? null,
      receiptUrl,
      invoiceUrl: receiptUrl,
      occurredAt: opts.occurredAt ?? new Date().toISOString(),
    },
  };
}

/** Sends one card event now. `provider` overrides the company's setting. */
export async function syncCardTransaction(
  card: VirtualCard,
  event: CardEvent,
  opts: { provider?: CardSyncProvider; amountInr?: number; occurredAt?: string } = {}
): Promise<CardSyncOutcome | { status: "failed"; error: string }> {
  try {
    const { txn, companyProvider } = await buildTransaction(card, event, opts);
    const provider: CardSyncProvider = opts.provider ?? (isCardSyncProvider(companyProvider) ? companyProvider : "webhook");
    const keys = cardSyncEnv(provider);
    const url = env(keys.url);
    const outcome = await deliverCardTransaction({ provider, url, token: env(keys.token), signingSecret: env("EXPENSE_WEBHOOK_SECRET") }, txn);
    audit({
      card_id: card.id,
      booking_id: card.booking_id,
      tenant_id: card.tenant_id,
      event,
      provider,
      status: outcome.status,
      attempts: outcome.attempts,
      destination: url ? new URL(url).host : "mock",
      payload_sha256: outcome.payloadSha256,
      ...(outcome.error && { error: outcome.error }),
    });
    return outcome;
  } catch (err) {
    const error = err instanceof Error ? err.message : "Card sync failed";
    audit({ card_id: card.id, booking_id: card.booking_id, event, status: "error", error });
    return { status: "failed", error };
  }
}

/** Queues a card event to send after the response (next/server after()). */
export function enqueueCardSync(card: VirtualCard, event: CardEvent): void {
  // Deferred, so a receipt exported in the same request is linked from the payload.
  const run = () => syncCardTransaction(card, event);
  try {
    after(run);
  } catch {
    // Outside a request (tests, scripts): run it now.
    void run();
  }
}

export class CardSettlementError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 | 503
  ) {
    super(message);
  }
}

export type SettlementResult =
  | { duplicate: true; cardId: string; status: VirtualCard["status"] }
  | { duplicate: false; cardId: string; sync: Awaited<ReturnType<typeof syncCardTransaction>>; receipt: DispatchOutcome | null };

/**
 * The issuer settled a charge on a card: marks it used (single-use), sends
 * card.settled, and exports the booking's receipt if it's confirmed (that
 * export is idempotent). A card that's no longer active is a duplicate.
 */
export async function settleCard(
  cardToken: string,
  input: { amountInr: number; settledAt?: string; provider?: CardSyncProvider }
): Promise<SettlementResult> {
  if (dataSource() !== "supabase") throw new CardSettlementError("Virtual cards need the live database.", 503);
  const db = createAdminClient();
  const { data: card, error } = await db.from("virtual_cards").select("*").eq("card_token", cardToken).maybeSingle();
  if (error) throw error;
  if (!card) throw new CardSettlementError("Card not found.", 404);
  if (card.status !== "active") return { duplicate: true, cardId: card.id, status: card.status };
  if (input.amountInr > Number(card.amount_limit_inr)) {
    throw new CardSettlementError(`Settlement of ₹${input.amountInr} exceeds the card limit of ₹${Number(card.amount_limit_inr)}.`, 422);
  }

  // Conditional on status, so concurrent deliveries settle it once.
  const { data: used, error: updateError } = await db.from("virtual_cards").update({ status: "used" }).eq("id", card.id).eq("status", "active").select("*").maybeSingle();
  if (updateError) throw updateError;
  if (!used) return { duplicate: true, cardId: card.id, status: "used" };

  const sync = await syncCardTransaction(used, "card.settled", { amountInr: input.amountInr, occurredAt: input.settledAt, provider: input.provider });
  const [booking] = await listBookings({ ids: [used.booking_id] });
  const receipt = booking && RECEIPT_READY.has(booking.status) ? await exportBookingExpense(booking.id) : null;
  return { duplicate: false, cardId: used.id, sync, receipt };
}
