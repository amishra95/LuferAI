"use server";

import { refresh, revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { publishVenueSync } from "@/lib/telemetry/live";
import { listDirectory, type PartnerStatus } from "@/lib/venues/directory";

export type VenueSyncResult = { total: number; partners: PartnerStatus };

/**
 * Re-pulls the venue directory: own venues, the partner network feed and the
 * extranet listings. Nothing is cached between requests, so this is a fresh
 * fetch plus a revalidation of /venues, announced on the live telemetry stream
 * so open directories and inspectors on every instance refresh too.
 */
export async function syncVenueDirectory(): Promise<ActionResult<VenueSyncResult>> {
  return serverDispatch(
    "venues/syncVenueDirectory",
    async () => {
      await requireWorkspace("/venues");
      const { venues, partners } = await listDirectory();
      revalidatePath("/venues");
      refresh();
      return { total: venues.length, partners };
    },
    { emit: ({ total, partners }) => publishVenueSync(total, partners) }
  );
}
