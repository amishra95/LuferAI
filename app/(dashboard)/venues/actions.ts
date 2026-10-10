"use server";

import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { listDirectory, type PartnerStatus } from "@/lib/venues/directory";

export type VenueSyncResult = { total: number; partners: PartnerStatus };

/**
 * Re-pulls the venue directory: own venues, the partner network feed and the
 * extranet listings. Nothing is cached between requests, so this is a fresh
 * fetch plus a revalidation of /venues for anyone already looking at it.
 */
export async function syncVenueDirectory(): Promise<VenueSyncResult> {
  await requireWorkspace("/venues");
  const { venues, partners } = await listDirectory();
  revalidatePath("/venues");
  return { total: venues.length, partners };
}
