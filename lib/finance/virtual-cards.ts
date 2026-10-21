import "server-only";

import { randomInt, randomUUID } from "node:crypto";

import type { Member } from "@/lib/auth/session";
import { dataSource, listBookings } from "@/lib/data";
import { enqueueCardSync } from "@/lib/expense/card-sync";
import { markCardReceipts } from "@/lib/finance/card-receipts";
import { exportBookingExpense } from "@/lib/finance/export-dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VirtualCard } from "@/lib/supabase/database.types";

/**
 * Single-use corporate virtual cards per approved booking (migration 0033).
 *
 * Issuers sit behind CardIssuer. Only the sandbox issuer exists today: its
 * tokens are labelled vc_sandbox_… and can't be spent anywhere. Connecting a
 * real issuer means adding one here (and to virtual_cards.provider's check);
 * the rules below stay the same.
 *
 * Rules: the booking must be the member's company's and fully approved
 * (PENDING with the venue, or CONFIRMED); the limit never exceeds its approved
 * invoice total (GST included); one active card per booking; the card expires
 * two days after the event.
 */
export interface IssuedCard {
  providerCardId: string;
  /** Opaque token the issuer resolves to the card: never a card number. */
  token: string;
  last4: string;
}

export interface CardIssuer {
  name: VirtualCard["provider"];
  issue(input: { amountLimitPaise: number; expiresAt: Date; reference: string; description: string }): Promise<IssuedCard>;
}

/** Test-only issuer: random identifiers, no network, nothing that can be charged. */
export const sandboxIssuer: CardIssuer = {
  name: "sandbox",
  async issue() {
    const id = randomUUID().replace(/-/g, "");
    return { providerCardId: `sbx_${id.slice(0, 16)}`, token: `vc_sandbox_${id}`, last4: String(randomInt(0, 10_000)).padStart(4, "0") };
  },
};

/** The configured issuer. Sandbox until a real one is integrated. */
export const cardIssuer = (): CardIssuer => sandboxIssuer;

export class VirtualCardError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400
  ) {
    super(message);
  }
}

/** Approved and still ahead of settlement: the venue has it (PENDING) or confirmed it. */
const ISSUABLE = new Set(["PENDING", "CONFIRMED"]);
const RECEIPT_READY = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);

export type CardView = Pick<VirtualCard, "id" | "booking_id" | "provider" | "last4" | "amount_limit_inr" | "status" | "expires_at" | "expense_sync_status"> & { sandbox: boolean };

const view = (c: VirtualCard): CardView => ({
  id: c.id,
  booking_id: c.booking_id,
  provider: c.provider,
  last4: c.last4,
  amount_limit_inr: Number(c.amount_limit_inr),
  status: c.status,
  expires_at: c.expires_at,
  expense_sync_status: c.expense_sync_status,
  sandbox: c.provider === "sandbox",
});

export async function issueVirtualCard(bookingId: string, member: Member, opts: { amountLimitInr?: number | null } = {}): Promise<{ card: CardView; approvedBudgetInr: number }> {
  if (dataSource() !== "supabase") throw new VirtualCardError("Virtual cards need the live database.", 503);
  if (member.role !== "CLIENT" && member.role !== "ADMIN") throw new VirtualCardError("Only client and admin users can issue cards.", 403);

  const [booking] = await listBookings({ ids: [bookingId] });
  if (!booking) throw new VirtualCardError("Booking not found.", 404);
  if (member.role !== "ADMIN" && booking.company_id !== member.companyId) throw new VirtualCardError("Booking not found.", 404);
  if (booking.status === "PENDING_APPROVAL") {
    throw new VirtualCardError("This booking is still waiting for internal approval. Send the approvers a reminder first.", 409);
  }
  if (!ISSUABLE.has(booking.status)) throw new VirtualCardError(`Cards are issued for approved, open bookings (this one is ${booking.status.toLowerCase()}).`, 409);

  // The approved budget: the booking's invoice total, GST included.
  const approved = Number(booking.invoice.invoice_total);
  const limit = opts.amountLimitInr ?? approved;
  if (!(limit > 0)) throw new VirtualCardError("The card limit must be more than zero.");
  if (limit > approved) throw new VirtualCardError(`The card limit can't exceed the approved budget of ₹${approved.toLocaleString("en-IN")}.`);

  // Two days after the event, end of day IST.
  const expiresAt = new Date(Date.parse(`${booking.event_date}T23:59:59+05:30`) + 2 * 86_400_000);
  const issuer = cardIssuer();
  const issued = await issuer.issue({
    amountLimitPaise: Math.round(limit * 100),
    expiresAt,
    reference: booking.id,
    description: `${booking.venue.name} · ${booking.event_date} · ${booking.party_size} guests`,
  });

  const { data, error } = await createAdminClient()
    .from("virtual_cards")
    .insert({
      tenant_id: booking.company_id,
      booking_id: booking.id,
      provider: issuer.name,
      provider_card_id: issued.providerCardId,
      card_token: issued.token,
      last4: issued.last4,
      amount_limit_inr: limit,
      expires_at: expiresAt.toISOString(),
      issued_by: member.userId,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new VirtualCardError("A card is already active for this booking.", 409);
    if (error.code === "42P01") throw new VirtualCardError("Virtual cards need database migration 0033. Ask an admin to apply it.", 503);
    throw error;
  }

  // The new card goes to the company's expense / ERP system after the response (card.issued).
  enqueueCardSync(data, "card.issued");

  // Confirmed bookings sync their itemised receipt now; others when the venue confirms.
  if (RECEIPT_READY.has(booking.status)) {
    const outcome = await exportBookingExpense(booking.id);
    await markCardReceipts(booking.id, outcome);
    const { data: synced } = await createAdminClient().from("virtual_cards").select("*").eq("id", data.id).single();
    return { card: view(synced ?? data), approvedBudgetInr: approved };
  }
  return { card: view(data), approvedBudgetInr: approved };
}
