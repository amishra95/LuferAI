"use server";

import { refresh, revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { dataSource, listBookings, listCompanies, listMenuPackages, listRateCards } from "@/lib/data";
import { opsQuoteEmail, QuoteRequest, requesterReceipt, type QuoteRequestInput } from "@/lib/concierge/request";
import { notifyConciergeRequest } from "@/lib/services/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInIndia } from "@/lib/gst-engine";
import { serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { isRateCardActive } from "@/lib/rates/apply-rate-card";
import { publishVenueSync } from "@/lib/telemetry/live";
import { listDirectory, type PartnerStatus } from "@/lib/venues/directory";

export interface VenueSyncResult {
  total: number;
  partners: PartnerStatus;
  /** Corporate rate cards in effect today, across the network. */
  activeRates: number;
  /** Active menu packages (corporate menus). */
  menus: number;
  /** Venue-dates taken in the next 30 days (live or confirmed bookings). */
  bookedDates: number;
}

const DAY_MS = 86_400_000;

/**
 * Re-syncs the venue network: the directory (own venues, the partner feed and
 * extranet listings), the corporate rates in effect, corporate menus and
 * near-term availability. Nothing is cached between requests, so this is a
 * fresh pull plus a revalidation of /venues, announced on the live telemetry
 * stream so open directories and inspectors on every instance refresh too.
 */
export async function triggerVenueDirectorySync(): Promise<ActionResult<VenueSyncResult>> {
  return serverDispatch(
    "venues/triggerVenueDirectorySync",
    async () => {
      const member = await requireWorkspace("/venues");
      const today = todayInIndia();
      const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * DAY_MS).toISOString().slice(0, 10);
      // Clients see only their own company's rates and bookings; admins the network's.
      const scope = member.role === "ADMIN" ? {} : { companyId: member.companyId ?? "" };
      const [{ venues, partners }, cards, menus, bookings] = await Promise.all([
        listDirectory(),
        listRateCards(member.role === "ADMIN" ? {} : { tenantId: member.companyId ?? "" }),
        listMenuPackages(),
        listBookings(scope),
      ]);
      const taken = new Set(
        bookings
          .filter((b) => ["PENDING_APPROVAL", "PENDING", "CONFIRMED"].includes(b.status) && b.event_date >= today && b.event_date <= horizon)
          .map((b) => `${b.venue_id}:${b.event_date}`)
      );
      revalidatePath("/venues");
      refresh();
      return {
        total: venues.length,
        partners,
        activeRates: cards.filter((c) => isRateCardActive(c, today)).length,
        menus: menus.length,
        bookedDates: taken.size,
      };
    },
    { emit: ({ total, partners }) => publishVenueSync(total, partners) }
  );
}

export type QuoteRequestResult = { ok: true } | { ok: false; error: string };

/**
 * "Request a quote" on a partner listing (Wizard of Oz): emails Lufer ops,
 * who arrange it with the venue, and sends the requester a receipt.
 */
export async function requestQuoteAction(input: QuoteRequestInput): Promise<QuoteRequestResult> {
  const member = await requireWorkspace("/venues");
  if (member.role !== "CLIENT" && member.role !== "ADMIN") return { ok: false, error: "Only company accounts can request quotes." };
  const parsed = QuoteRequest.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  if (dataSource() !== "supabase") return { ok: false, error: "Quote requests need the live database." };

  const { data: venue, error } = await createAdminClient().from("partner_venues").select("name, area, address").eq("id", parsed.data.venueId).eq("status", "active").maybeSingle();
  if (error) throw error;
  if (!venue) return { ok: false, error: "That venue isn't available any more." };
  const company = member.companyId ? (await listCompanies()).find((c) => c.id === member.companyId) : null;
  const ctx = { companyName: company?.legal_name ?? "Lufer admin (test)", requesterEmail: member.email ?? "unknown" };

  const sent = await notifyConciergeRequest(opsQuoteEmail(ctx, venue, parsed.data), {
    email: ctx.requesterEmail,
    ...requesterReceipt(`${venue.name} on ${parsed.data.date} for ${parsed.data.guests} guests`),
  });
  if (!sent.delivered) {
    console.error("venues: quote request not delivered", sent.reason);
    return { ok: false, error: "We couldn't send that just now. Try again in a minute." };
  }
  return { ok: true };
}
