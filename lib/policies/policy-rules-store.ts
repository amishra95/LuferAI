import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { rowsFromRules, type PolicyRules } from "./policy-rules";

/**
 * Saves a company's booking rules (Policies → Rules): corporate_policies and
 * the monthly limit on companies. Live data only; callers check the member may
 * manage the company's governance first.
 */
export async function savePolicyRules(companyId: string, rules: PolicyRules): Promise<void> {
  const db = createAdminClient();
  const { policy, monthlyLimit } = rowsFromRules(rules);
  const { error: policyError } = await db.from("corporate_policies").upsert({ tenant_id: companyId, ...policy }, { onConflict: "tenant_id" });
  if (policyError) throw policyError;
  const { error: limitError } = await db.from("companies").update({ monthly_spend_limit_inr: monthlyLimit }).eq("id", companyId);
  if (limitError) throw limitError;
}
