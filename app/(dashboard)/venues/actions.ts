"use server";

import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { publishVenueSync } from "@/lib/telemetry/live";
import { listDirectory, type PartnerStatus } from "@/lib/venues/directory";

export type VenueSyncResult = { total: number; partners: PartnerStatus };

/**
 * Re-pulls the venue directory: own venues, the partner network feed and the
 * extranet listings. Nothing is cached between requests, so this is a fresh
 * fetch plus a revalidation of /venues, announced on the live telemetry stream.
 */
export async function syncVenueDirectory(): Promise<VenueSyncResult> {
  await requireWorkspace("/venues");
  const { venues, partners } = await listDirectory();
  revalidatePath("/venues");
  // Open inspectors and directory views on every instance refresh from this.
  await publishVenueSync(venues.length, partners);
  return { total: venues.length, partners };
}
