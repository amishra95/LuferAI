"use client";

import { useCallback } from "react";

import { syncVenueDirectory, type VenueSyncResult } from "@/app/(dashboard)/venues/actions";
import { useAction } from "@/components/workspace/use-optimistic-mutation";

/** Dispatches a venue directory re-sync from ⌘K or the inspector, with toasts. */
export function useVenueSync() {
  const { run, pending } = useAction<VenueSyncResult>();
  const sync = useCallback(
    () =>
      run(() => syncVenueDirectory(), {
        failure: "Venue sync failed",
        success: ({ total, partners }) =>
          partners.status === "ok"
            ? { tone: "success", title: "Venue directory synced", description: `${total} venues · ${partners.count} from ${partners.network}` }
            : { tone: "info", title: "Venue directory synced without partners", description: `${partners.network} is unavailable (${partners.error}). ${total} venues listed.` },
      }),
    [run]
  );
  return { sync, syncing: pending };
}
