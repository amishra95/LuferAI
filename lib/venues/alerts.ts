import "server-only";

import { after } from "next/server";

import { dataSource, listBookings } from "@/lib/data";
import { sendVenueAlert } from "@/lib/services/notifications";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { bookingRequestAlert, rfpAlert, type AlertMessage } from "./alert-messages";

/**
 * Tells a venue, by email, that a company wants it. Without this a request
 * waits unseen in /property while its 24-hour hold runs out. Venues with no
 * manager yet (added by Lufer, not signed up) alert the concierge inbox
 * (CONCIERGE_EMAIL) instead, who calls the venue. Runs after the response;
 * never throws.
 */

const HOLD_HOURS = 24;

async function recipients(venueId: string): Promise<{ emails: string[]; concierge: boolean }> {
  const db = createAdminClient();
  const { data } = await db.from("platform_users").select("user_id").eq("role", "PROPERTY").eq("venue_id", venueId);
  const emails = (
    await Promise.all(
      (data ?? []).map(async (r) => {
        const { data: u } = await db.auth.admin.getUserById(r.user_id);
        return u?.user?.email ?? null;
      })
    )
  ).filter((e): e is string => Boolean(e));
  if (emails.length) return { emails, concierge: false };
  const concierge = process.env.CONCIERGE_EMAIL?.trim();
  return { emails: concierge ? [concierge] : [], concierge: true };
}

function runAfter(work: Promise<unknown>) {
  try {
    after(work);
  } catch {
    // Outside a request (tests, scripts): the promise still runs.
  }
}

async function deliver(venueId: string, build: (concierge: boolean) => AlertMessage) {
  const { emails, concierge } = await recipients(venueId);
  if (!emails.length) return console.warn(`venue alert: no recipient for ${venueId}`);
  const message = build(concierge);
  for (const to of emails) {
    const outcome = await sendVenueAlert(to, message);
    if (outcome.status !== "sent") console.warn(`venue alert to ${venueId} ${outcome.status}:`, "reason" in outcome ? outcome.reason : outcome.error);
  }
}

/** A booking request just reached the venue (status PENDING). */
export function alertVenueBookingRequest(bookingId: string, venueId: string): void {
  if (dataSource() !== "supabase" || !bookingId || !venueId) return;
  runAfter(
    (async () => {
      const booking = (await listBookings({ venueId })).find((b) => b.id === bookingId);
      if (!booking || booking.status !== "PENDING") return;
      const link = new URL("/property", siteUrl("https://lufer.app")).toString();
      await deliver(venueId, (concierge) =>
        bookingRequestAlert(
          {
            venueName: booking.venue.name,
            companyName: booking.company.legal_name,
            eventDate: booking.event_date,
            guests: booking.party_size,
            perHead: Number(booking.budget_per_head_inr),
            taxable: booking.total_amount_inr,
            payout: booking.venue_payout_inr,
            notes: booking.notes ?? null,
            holdExpiresAt: new Date(Date.now() + HOLD_HOURS * 3_600_000),
          },
          link,
          concierge
        )
      );
    })().catch((err) => console.error(`venue alert for booking ${bookingId} failed`, err))
  );
}

/** An RFP reached the venue; `link` is its no-login quote page (lib/vendor). */
export function alertVenueRfp(venueId: string, rfp: { venueName: string; companyName: string; guests: number; eventDate: string | null; perHead: number | null }, link: string): void {
  if (dataSource() !== "supabase") return;
  runAfter(deliver(venueId, (concierge) => rfpAlert(rfp, link, concierge)).catch((err) => console.error(`venue RFP alert for ${venueId} failed`, err)));
}

/** A company cancelled, or asked to cancel, a booking at the venue (lib/bookings/cancellation.ts). */
export function alertVenueCancellation(venueId: string, message: { subject: string; lines: string[] }): void {
  if (dataSource() !== "supabase" || !venueId) return;
  runAfter(deliver(venueId, () => message).catch((err) => console.error(`venue cancellation alert for ${venueId} failed`, err)));
}
