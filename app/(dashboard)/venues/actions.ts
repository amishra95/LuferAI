"use server";

import { refresh, revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { listBookings, listMenuPackages, listRateCards } from "@/lib/data";
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
