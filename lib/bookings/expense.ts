/**
 * Expense metadata finance needs on every booking. Pure (no server imports) so
 * tests/enterprise.test.mjs can exercise it.
 */
import { normalizeGstin, validateGstin } from "../gst-engine.ts";

export type ExpenseField = "cost_center" | "project_code" | "billing_gstin";

export interface ExpenseInput {
  costCenter?: string | null;
  projectCode?: string | null;
  /** Billing GSTIN; blank = the company's registered GSTIN. */
  taxId?: string | null;
}

export interface ExpenseMetadata {
  cost_center: string;
  project_code: string | null;
  billing_gstin: string | null;
}

/** Same rule as the bookings.cost_center / project_code check constraints. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$/;

/**
 * Normalises and validates expense metadata. A billing GSTIN must be valid and
 * belong to the same legal entity as the company (same PAN, characters 3–12);
 * a different state registration of that entity is fine.
 */
export function validateExpense(
  input: ExpenseInput,
  companyGstin: string
): { ok: true; value: ExpenseMetadata } | { ok: false; errors: Partial<Record<ExpenseField, string>> } {
  const errors: Partial<Record<ExpenseField, string>> = {};
  const costCenter = (input.costCenter ?? "").trim().toUpperCase();
  const projectCode = (input.projectCode ?? "").trim().toUpperCase();
  const taxId = normalizeGstin(input.taxId ?? "");

  if (!costCenter) errors.cost_center = "Enter a cost centre";
  else if (!CODE.test(costCenter)) errors.cost_center = "Cost centre: 2–32 letters, digits, . _ / -";
  if (projectCode && !CODE.test(projectCode)) errors.project_code = "Project code: 2–32 letters, digits, . _ / -";

  if (taxId) {
    const check = validateGstin(taxId);
    if (!check.valid) errors.billing_gstin = check.reason ?? "Invalid GSTIN";
    else if (taxId.slice(2, 12) !== normalizeGstin(companyGstin).slice(2, 12)) {
      errors.billing_gstin = "This GSTIN belongs to a different legal entity (PAN doesn't match your company)";
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      cost_center: costCenter,
      project_code: projectCode || null,
      // Stored only when it differs from the company's own registration.
      billing_gstin: taxId && taxId !== normalizeGstin(companyGstin) ? taxId : null,
    },
  };
}
