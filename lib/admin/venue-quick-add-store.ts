import "server-only";

import { addPropertyManager, ManagerError } from "@/lib/admin/property-managers";
import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveMenuPackage } from "@/lib/venues/pricing-store";
import type { VenueQuickAddValue } from "./venue-quick-add";

export class QuickAddError extends Error {}

export interface QuickAddResult {
  venueId: string;
  published: boolean;
  packages: number;
  /** "invited" | "linked" (existing account) | an error message | null (none asked). */
  manager: string | null;
}

/**
 * Creates the venue (Bengaluru, Karnataka), its packages and, if given, its
 * manager. The venue row comes first; package or manager failures after it are
 * reported, not rolled back, so a half-entered venue can be finished on /property.
 */
export async function quickAddVenue(v: VenueQuickAddValue, managerRedirect: string): Promise<QuickAddResult> {
  if (dataSource() !== "supabase") throw new QuickAddError("Adding venues needs the live database.");
  const db = createAdminClient();

  const { data: dup, error: dupError } = await db.from("venues").select("id").ilike("name", v.name).eq("neighborhood", v.neighborhood).maybeSingle();
  if (dupError) throw dupError;
  if (dup) throw new QuickAddError(`${v.name} in ${v.neighborhood} is already listed.`);
  if (v.gstin) {
    const { data: sameGstin, error } = await db.from("venues").select("name").eq("gstin", v.gstin).maybeSingle();
    if (error) throw error;
    if (sameGstin) throw new QuickAddError(`That GSTIN is already on ${sameGstin.name}.`);
  }

  const { data: venue, error } = await db
    .from("venues")
    .insert({
      name: v.name,
      neighborhood: v.neighborhood,
      city: "Bengaluru",
      address: v.address,
      capacity_max: v.capacity,
      pdr_available: v.privateRoom,
      serves_alcohol: v.servesAlcohol,
      min_spend_inr: v.minSpend,
      gstin: v.gstin || null,
      state_code: v.gstin ? v.gstin.slice(0, 2) : "29",
      latitude: v.latitude,
      longitude: v.longitude,
      is_active: v.publish,
    })
    .select("id")
    .single();
  if (error) throw error;

  let packages = 0;
  for (const p of v.packages) {
    await saveMenuPackage(venue.id, { packageId: null, name: p.name, perHeadInr: p.perHead, dietaryTags: p.dietary, description: null, isActive: true });
    packages++;
  }

  let manager: string | null = null;
  if (v.managerEmail) {
    try {
      const { invited } = await addPropertyManager({ email: v.managerEmail, name: v.managerName, phone: "", venueId: venue.id }, managerRedirect);
      manager = invited ? "invited" : "linked";
    } catch (err) {
      manager = err instanceof ManagerError ? err.message : "Couldn't add the manager; add them from Venue managers.";
    }
  }

  return { venueId: venue.id, published: v.publish, packages, manager };
}
