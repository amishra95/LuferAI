import { z } from "zod";

import { CardSettlementError, settleCard } from "@/lib/expense/card-sync";
import { isCardSyncProvider, verifySignature } from "@/lib/expense/webhook-dispatcher";
import { exportBookingExpense } from "@/lib/finance/export-dispatcher";
import { tracer } from "@/lib/tracer";

export const maxDuration = 60;

/**
 * Inbound expense events from the card issuer or a venue system, signed with
 * EXPENSE_INBOUND_SECRET (X-Lufer-Signature: sha256=<hex HMAC of the raw body>).
 *
 *   card.settled       { card_id: "vc_sandbox_…", amount_inr, settled_at? }  marks the card used,
 *                      syncs the charge and, for a confirmed booking, its receipt
 *   booking.confirmed  { booking_id }  exports the booking's itemised receipt
 *
 * Card events go to companies.expense_provider, or to X-Lufer-Provider
 * (ramp, brex, concur, zoho, webhook) when the sender names one. Both events
 * are idempotent, so redeliveries are safe.
 */
const Event = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("card.settled"),
    card_id: z.string().regex(/^vc_[a-z]+_[A-Za-z0-9]{8,190}$/),
    amount_inr: z.number().positive().max(100_000_000),
    settled_at: z.iso.datetime({ offset: true }).optional(),
  }),
  z.object({ event: z.literal("booking.confirmed"), booking_id: z.uuid() }),
]);

async function handleExpense(req: Request) {
  const secret = (process.env.EXPENSE_INBOUND_SECRET ?? "").trim();
  if (!secret) return Response.json({ error: "Expense webhooks are not configured." }, { status: 503 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-lufer-signature"), secret)) return Response.json({ error: "Invalid signature." }, { status: 401 });

  const providerHeader = req.headers.get("x-lufer-provider")?.trim().toLowerCase();
  if (providerHeader && !isCardSyncProvider(providerHeader)) return Response.json({ error: `Unknown provider "${providerHeader}".` }, { status: 400 });
  const provider = isCardSyncProvider(providerHeader) ? providerHeader : undefined;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Event.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid event.", issues: parsed.error.issues.map((i) => i.message) }, { status: 422 });
  const e = parsed.data;

  if (e.event === "booking.confirmed") {
    const receipt = await exportBookingExpense(e.booking_id);
    return Response.json({ ok: receipt.status !== "failed", event: e.event, receipt }, { status: receipt.status === "failed" ? 409 : 200 });
  }

  try {
    const result = await settleCard(e.card_id, { amountInr: e.amount_inr, settledAt: e.settled_at, provider });
    return Response.json({ ok: true, event: e.event, ...result });
  } catch (err) {
    if (err instanceof CardSettlementError) return Response.json({ error: err.message }, { status: err.status });
    console.error("expense webhook: settlement failed", err);
    // A 5xx asks the sender to retry; settlement is idempotent.
    return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
  }
}

export const POST = tracer.traceResponse("webhook.expense", handleExpense);
