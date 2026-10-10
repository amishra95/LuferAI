import "server-only";

import { updateBookingStatus } from "@/lib/data";
import { dispatchBookingConfirmed, type DispatchOutcome } from "@/lib/finance/export-dispatcher";
import { settleDeposit } from "@/lib/payments/service";

/**
 * Confirms a PENDING booking at its venue, with everything confirmation
 * entails: the date hold converts (trigger / local mirror), the expense receipt
 * is exported, and an authorised deposit is captured. Used by the venue's own
 * confirmation and by the booking agent for pre-agreed corporate terms.
 * Export and deposit failures are recorded, never block the confirmation.
 */
export async function confirmBooking(bookingId: string, venueId: string): Promise<{ expense: DispatchOutcome }> {
  await updateBookingStatus(bookingId, "CONFIRMED", { venueId });
  const expense = await dispatchBookingConfirmed(bookingId);
  await settleDeposit(bookingId, "capture");
  return { expense };
}
