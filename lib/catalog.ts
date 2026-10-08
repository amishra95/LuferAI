import "server-only";

import { dataSource, listDepartments, listVenues } from "@/lib/data";
import { todayInIndia } from "@/lib/gst-engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRateCardActive } from "@/lib/rates/apply-rate-card";
import type { Department } from "@/lib/supabase/database.types";

export interface CatalogVenue {
  id: string;
  name: string;
  neighborhood: string;
  city: string;
  address: string;
  gstin: string;
  capacity_max: number;
  min_spend_inr: number;
  pdr_available: boolean;
  latitude: number | null;
  longitude: number | null;
  /** The company's corporate rate card here today, summarised for a badge (null = list pricing). */
  rate_card: { label: string; minSpendOverride: number | null } | null;
  packages: { id: string; name: string; per_head_inr: number; dietary_tags: string[]; description: string | null }[];
}

function summariseRateCard(
  card: { discount_percentage: number; custom_per_head_rate: number | null; minimum_spend_override: number | null } | null
): CatalogVenue["rate_card"] {
  if (!card) return null;
  const custom = card.custom_per_head_rate != null ? Number(card.custom_per_head_rate) : null;
  const pct = Number(card.discount_percentage);
  if (custom == null && !(pct > 0) && card.minimum_spend_override == null) return null;
  const label =
    custom != null
      ? `₹${custom.toLocaleString("en-IN")}/head`
      : pct > 0
        ? `−${pct.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`
        : "Custom minimum";
  return { label, minSpendOverride: card.minimum_spend_override != null ? Number(card.minimum_spend_override) : null };
}

/** Active venues as this company would be quoted: packages, coordinates and rate card. */
export async function getVenueCatalog(companyId: string): Promise<{ venues: CatalogVenue[]; departments: Department[] }> {
  const venues = await listVenues();
  if (dataSource() !== "supabase") {
    return {
      venues: venues.map((v) => ({ ...v, min_spend_inr: Number(v.min_spend_inr), latitude: v.latitude, longitude: v.longitude, rate_card: null, packages: [] })),
      departments: await listDepartments({ companyIds: [companyId] }),
    };
  }

  const db = createAdminClient();
  const [{ data: packages }, { data: cards }, { data: departments }] = await Promise.all([
    db.from("venue_menu_packages").select("id, venue_id, name, per_head_inr, dietary_tags, description").eq("is_active", true).order("per_head_inr"),
    db.from("corporate_rate_cards").select("*").eq("tenant_id", companyId),
    db.from("departments").select("*").eq("company_id", companyId).order("name"),
  ]);
  const today = todayInIndia();

  return {
    venues: venues.map((v) => ({
      id: v.id,
      name: v.name,
      neighborhood: v.neighborhood,
      city: v.city,
      address: v.address,
      gstin: v.gstin,
      capacity_max: v.capacity_max,
      min_spend_inr: Number(v.min_spend_inr),
      pdr_available: v.pdr_available,
      latitude: v.latitude != null ? Number(v.latitude) : null,
      longitude: v.longitude != null ? Number(v.longitude) : null,
      rate_card: summariseRateCard((cards ?? []).find((c) => c.venue_id === v.id && isRateCardActive(c, today)) ?? null),
      packages: (packages ?? [])
        .filter((p) => p.venue_id === v.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          per_head_inr: Number(p.per_head_inr),
          dietary_tags: p.dietary_tags,
          description: p.description,
        })),
    })),
    departments: departments ?? [],
  };
}
