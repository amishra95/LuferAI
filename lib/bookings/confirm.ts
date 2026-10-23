import "server-only";

import { updateBookingStatus } from "@/lib/data";
import { dispatchBookingConfirmed, type DispatchOutcome } from "@/lib/finance/export-dispatcher";
import { queueTaxInvoice } from "@/lib/finance/tax-invoice-queue";
import { settleDeposit } from "@/lib/payments/service";
import { contractRequiredForBooking } from "@/lib/services/contracts/contractStore";

/** The booking's company confirms by contract (migration 0031); the countersignature does it. */
export class ContractRequiredError extends Error {
  constructor() {
    super("This client confirms bookings by signed contract. Issue or countersign the contract instead.");
    this.name = "ContractRequiredError";
  }
}

/**
 * Confirms a PENDING booking at its venue, with everything confirmation
 * entails: the date hold converts (trigger / local mirror), the expense receipt
 * is exported, the tax invoice document is queued for rendering
 * (workflows/tax-invoice.ts), and an authorised deposit is captured. Used by the venue's own
 * confirmation and by the booking agent for pre-agreed corporate terms.
 * Export and deposit failures are recorded, never block the confirmation.
 * Refused for companies that confirm by contract (bookings_require_contract
 * enforces it in Postgres too).
 */
export async function confirmBooking(bookingId: string, venueId: string): Promise<{ expense: DispatchOutcome }> {
  if (await contractRequiredForBooking(bookingId)) throw new ContractRequiredError();
  await updateBookingStatus(bookingId, "CONFIRMED", { venueId });
  const expense = await dispatchBookingConfirmed(bookingId);
  await queueTaxInvoice(bookingId);
  await settleDeposit(bookingId, "capture");
  return { expense };
}
