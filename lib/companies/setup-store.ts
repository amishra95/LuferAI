import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { officeArea, type CompanySetup } from "./setup";

/**
 * Saves a company's office area and per-head approval tiers (live data only;
 * callers check the member may manage the company's governance first).
 */
export async function saveCompanySetup(companyId: string, setup: CompanySetup): Promise<void> {
  const db = createAdminClient();
  const area = setup.officeArea ? officeArea(setup.officeArea) : null;
  const office = area
    ? { office_latitude: area.latitude, office_longitude: area.longitude, office_label: area.label }
    : { office_latitude: null, office_longitude: null };
  const { error: officeError } = await db.from("companies").update(office).eq("id", companyId);
  if (officeError) throw officeError;

  const { error: policyError } = await db.from("corporate_policies").upsert(
    {
      tenant_id: companyId,
      auto_approval_limit_per_head: setup.autoApprovePerHead,
      manager_approval_limit_per_head: setup.managerPerHead,
      max_budget_per_head: setup.maxPerHead,
      max_office_distance_km: setup.maxDistanceKm,
    },
    { onConflict: "tenant_id" }
  );
  if (policyError) throw policyError;
}
