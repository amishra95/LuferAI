import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { officeArea, type CompanySetup } from "./setup";

/**
 * Saves a company's billing address and office area (booking rules: lib/policies/policy-rules-store.ts) (live data only;
 * callers check the member may manage the company's governance first).
 */
export async function saveCompanySetup(companyId: string, setup: CompanySetup): Promise<void> {
  const db = createAdminClient();
  const area = setup.officeArea ? officeArea(setup.officeArea) : null;
  const office = area
    ? { office_latitude: area.latitude, office_longitude: area.longitude, office_label: area.label }
    : { office_latitude: null, office_longitude: null };
  const { error: officeError } = await db.from("companies").update({ ...office, billing_address: setup.billingAddress }).eq("id", companyId);
  if (officeError) throw officeError;
}
