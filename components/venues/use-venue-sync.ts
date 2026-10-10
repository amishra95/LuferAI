"use client";

import { useCallback } from "react";

import { triggerVenueDirectorySync, type VenueSyncResult } from "@/app/(dashboard)/venues/actions";
import { useAction } from "@/components/workspace/use-optimistic-mutation";

/** Dispatches a venue network re-sync (directory, corporate rates, menus, availability) from ⌘K or the inspector. */
export function useVenueSync() {
  const { run, pending } = useAction<VenueSyncResult>();
  const sync = useCallback(
    () =>
      run(() => triggerVenueDirectorySync(), {
        failure: "Venue sync failed",
        success: ({ total, partners, activeRates, menus, bookedDates }) => {
          const detail = `${total} venues · ${activeRates} corporate rate${activeRates === 1 ? "" : "s"} · ${menus} menu${menus === 1 ? "" : "s"} · ${bookedDates} dates booked in the next 30 days`;
          return partners.status === "ok"
            ? { tone: "success", title: "Venue network synced", description: `${detail} · ${partners.count} from ${partners.network}` }
            : { tone: "info", title: "Venue network synced without partners", description: `${partners.network} is unavailable (${partners.error}). ${detail}` };
        },
      }),
    [run]
  );
  return { sync, syncing: pending };
}
