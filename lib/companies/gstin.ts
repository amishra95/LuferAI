import { normalizeGstin, validateGstin } from "../gst-engine.ts";

/**
 * A company may sign up without its GSTIN, but it can't book until it adds one
 * (bookings_require_company_gstin in the database). Anything that invoices,
 * contracts or settles a booking therefore has one; this says so, and fails
 * loudly if not.
 */
export function billableGstin(company: { legal_name?: string; gstin: string | null }): string {
  if (!company.gstin) throw new Error(`${company.legal_name ?? "This company"} has no GSTIN yet, so it can't be invoiced.`);
  return company.gstin;
}

/**
 * The GSTIN a booking or order bills to, for a company that may not have one
 * yet. With one: it, and the form's GSTIN stays an optional branch GSTIN. Without
 * one: the form's GSTIN is required and becomes the company's (`adopt`), which
 * the caller saves before booking.
 */
export function bookingCompanyGstin(
  registered: string | null,
  formGstin: string | null | undefined
): { ok: true; gstin: string; adopt: boolean } | { ok: false; error: string } {
  if (registered) return { ok: true, gstin: registered, adopt: false };
  const gstin = normalizeGstin(formGstin ?? "");
  if (!gstin) return { ok: false, error: "Enter your company's GSTIN: the invoice is raised on it." };
  const check = validateGstin(gstin);
  if (!check.valid) return { ok: false, error: check.reason ?? "That GSTIN isn't valid. Check the 15 characters." };
  return { ok: true, gstin, adopt: true };
}

export const GSTIN_TAKEN =
  "This GSTIN is already registered to a company on Lufer. Ask a colleague there to invite you, or contact us.";
