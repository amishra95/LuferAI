/**
 * GST Tax Engine
 * ----------------------------------------------------------------------------
 * Determines intra-state (CGST + SGST) vs inter-state (IGST) treatment from the
 * two parties' GSTINs and produces a structured tax-invoice payload under
 * SAC 998596.
 *
 * Conventions
 * - `total_amount` is the TAXABLE VALUE (pre-GST) in INR.
 * - All arithmetic is done in integer paise to avoid floating-point drift;
 *   each tax head is rounded half-up to the nearest paisa.
 * - Mirrors the SQL in supabase/migrations (gstin_checksum, booking_tax_breakdown).
 *
 * Written with erasable-only TypeScript (no enums/namespaces) so it can be run
 * directly by Node's type stripping in tests.
 */

export const SAC_CODE = "998596";
export const SAC_DESCRIPTION = "Corporate Event & Hospitality Procurement Services";
export const GST_RATE_PERCENT = 18;
export const CGST_RATE_PERCENT = 9;
export const SGST_RATE_PERCENT = 9;
export const IGST_RATE_PERCENT = 18;

export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export type GstType = "CGST_SGST" | "IGST";
export type SupplyType = "INTRA_STATE" | "INTER_STATE";

export interface GstBookingInput {
  /** Taxable value in INR (pre-GST). */
  total_amount: number;
  /** Recipient (corporate client) GSTIN. */
  company_gstin: string;
  /** Supplier (venue) GSTIN. */
  venue_gstin: string;
  /** Optional metadata carried onto the invoice. */
  booking_id?: string;
  invoice_number?: string;
  invoice_date?: string; // ISO date, defaults to today
}

export interface TaxHead {
  rate_percent: number;
  amount: number; // INR, 2dp
}

export interface GstParty {
  gstin: string;
  state_code: string;
  state_name: string;
}

export interface TaxInvoicePayload {
  document_type: "TAX_INVOICE";
  invoice_number: string | null;
  invoice_date: string;
  booking_id: string | null;
  sac: { code: typeof SAC_CODE; description: typeof SAC_DESCRIPTION };
  supplier: GstParty;
  recipient: GstParty;
  place_of_supply: { state_code: string; state_name: string };
  supply_type: SupplyType;
  gst_type: GstType;
  currency: "INR";
  taxable_value: number;
  tax_breakup: {
    cgst: TaxHead;
    sgst: TaxHead;
    igst: TaxHead;
  };
  total_tax: number;
  invoice_total: number;
  /** Eligible input tax credit for the recipient, subject to Section 16/17 conditions. */
  itc_eligible_amount: number;
}

export class GstEngineError extends Error {
  readonly code: "INVALID_GSTIN" | "INVALID_AMOUNT";
  constructor(code: "INVALID_GSTIN" | "INVALID_AMOUNT", message: string) {
    super(message);
    this.name = "GstEngineError";
    this.code = code;
  }
}

// ----------------------------------------------------------------------------
// GSTIN helpers
// ----------------------------------------------------------------------------

const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normalizeGstin(gstin: string): string {
  return gstin.replace(/\s+/g, "").toUpperCase();
}

/** Computes the 15th (checksum) character from the first 14 characters of a GSTIN. */
export function computeGstinChecksum(first14: string): string {
  if (first14.length !== 14) {
    throw new GstEngineError("INVALID_GSTIN", "Checksum needs exactly 14 characters");
  }
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_ALPHABET.indexOf(first14[i]);
    if (value < 0) {
      throw new GstEngineError("INVALID_GSTIN", `Invalid GSTIN character "${first14[i]}"`);
    }
    const product = value * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_ALPHABET[(36 - (total % 36)) % 36];
}

export interface GstinValidation {
  valid: boolean;
  reason?: string;
}

export function validateGstin(raw: string): GstinValidation {
  const gstin = normalizeGstin(raw);
  if (gstin.length !== 15) return { valid: false, reason: "GSTIN must be 15 characters" };
  if (!GSTIN_PATTERN.test(gstin)) return { valid: false, reason: "GSTIN format is invalid" };
  if (!(gstin.slice(0, 2) in GST_STATE_CODES)) {
    return { valid: false, reason: `Unknown GST state code "${gstin.slice(0, 2)}"` };
  }
  if (computeGstinChecksum(gstin.slice(0, 14)) !== gstin[14]) {
    return { valid: false, reason: "GSTIN checksum digit does not match" };
  }
  return { valid: true };
}

/** Returns the 2-digit GST state code, e.g. "29" (Karnataka) or "07" (Delhi). */
export function extractStateCode(gstin: string): string {
  const normalized = normalizeGstin(gstin);
  const check = validateGstin(normalized);
  if (!check.valid) {
    throw new GstEngineError("INVALID_GSTIN", `${normalized || "(empty)"}: ${check.reason}`);
  }
  return normalized.slice(0, 2);
}

export function stateName(stateCode: string | null | undefined): string {
  return (stateCode && GST_STATE_CODES[stateCode]) || "Unknown";
}

/**
 * State code of a stored company or venue, for display. The DB column is
 * generated as the GSTIN's first two characters, but Postgres reports generated
 * columns as nullable, so this falls back to the same derivation. Tax logic must
 * use extractStateCode, which validates the GSTIN instead of trusting a stored value.
 */
export function partyStateCode(party: { gstin: string; state_code: string | null }): string {
  return party.state_code ?? normalizeGstin(party.gstin).slice(0, 2);
}

export function determineGstType(companyGstin: string, venueGstin: string): GstType {
  return extractStateCode(companyGstin) === extractStateCode(venueGstin) ? "CGST_SGST" : "IGST";
}

// ----------------------------------------------------------------------------
// Money helpers (integer paise)
// ----------------------------------------------------------------------------

/** Largest value numeric(14,2) can hold — the bookings.total_amount_inr column type. */
export const MAX_AMOUNT_INR = 999_999_999_999.99;

/**
 * INR → integer paise, rounded half-up like Postgres numeric(14,2).
 * `inr * 100` alone carries binary float error (1.005 * 100 = 100.49999…), so it
 * is snapped to 15 significant digits before rounding.
 */
const toPaise = (inr: number): number => Math.round(Number((inr * 100).toPrecision(15)));
const toInr = (paise: number): number => paise / 100;
/** Rate in whole percent applied to paise, rounded half-up to the nearest paisa. */
const pct = (paise: number, ratePercent: number): number => Math.round((paise * ratePercent) / 100);

/** Today's date in India (IST), as YYYY-MM-DD. A UTC date is a day behind until 05:30 IST. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

export function calculateGst(input: GstBookingInput): TaxInvoicePayload {
  if (!Number.isFinite(input.total_amount) || input.total_amount < 0) {
    throw new GstEngineError("INVALID_AMOUNT", "total_amount must be a non-negative finite number");
  }
  if (input.total_amount > MAX_AMOUNT_INR) {
    throw new GstEngineError("INVALID_AMOUNT", `total_amount cannot exceed ₹${MAX_AMOUNT_INR}`);
  }

  const companyGstin = normalizeGstin(input.company_gstin);
  const venueGstin = normalizeGstin(input.venue_gstin);
  const recipientState = extractStateCode(companyGstin);
  const supplierState = extractStateCode(venueGstin);

  const isIntraState = recipientState === supplierState;
  const gstType: GstType = isIntraState ? "CGST_SGST" : "IGST";

  const taxablePaise = toPaise(input.total_amount);
  const cgstPaise = isIntraState ? pct(taxablePaise, CGST_RATE_PERCENT) : 0;
  const sgstPaise = isIntraState ? pct(taxablePaise, SGST_RATE_PERCENT) : 0;
  const igstPaise = isIntraState ? 0 : pct(taxablePaise, IGST_RATE_PERCENT);
  const totalTaxPaise = cgstPaise + sgstPaise + igstPaise;

  return {
    document_type: "TAX_INVOICE",
    invoice_number: input.invoice_number ?? null,
    invoice_date: input.invoice_date ?? todayInIndia(),
    booking_id: input.booking_id ?? null,
    sac: { code: SAC_CODE, description: SAC_DESCRIPTION },
    supplier: { gstin: venueGstin, state_code: supplierState, state_name: stateName(supplierState) },
    recipient: { gstin: companyGstin, state_code: recipientState, state_name: stateName(recipientState) },
    // B2B event services: place of supply = location of the registered recipient.
    place_of_supply: { state_code: recipientState, state_name: stateName(recipientState) },
    supply_type: isIntraState ? "INTRA_STATE" : "INTER_STATE",
    gst_type: gstType,
    currency: "INR",
    taxable_value: toInr(taxablePaise),
    tax_breakup: {
      cgst: { rate_percent: isIntraState ? CGST_RATE_PERCENT : 0, amount: toInr(cgstPaise) },
      sgst: { rate_percent: isIntraState ? SGST_RATE_PERCENT : 0, amount: toInr(sgstPaise) },
      igst: { rate_percent: isIntraState ? 0 : IGST_RATE_PERCENT, amount: toInr(igstPaise) },
    },
    total_tax: toInr(totalTaxPaise),
    invoice_total: toInr(taxablePaise + totalTaxPaise),
    itc_eligible_amount: toInr(totalTaxPaise),
  };
}

// ----------------------------------------------------------------------------
// Commission / payout (mirrors booking_tax_breakdown)
// ----------------------------------------------------------------------------

export interface CommissionSplit {
  commission_rate: number;
  /** round(taxable × rate, 2), half-up — same as Postgres numeric round(). */
  commission: number;
  venue_payout: number;
}

/**
 * Splits a taxable value into platform commission and venue payout.
 * `commissionRate` is a fraction stored as numeric(5,4) (0.15 = 15%), so it is
 * scaled to integer ten-thousandths and multiplied in BigInt — paise × 10 000
 * can exceed Number.MAX_SAFE_INTEGER for large bookings.
 */
export function splitCommission(taxableInr: number, commissionRate: number): CommissionSplit {
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1) {
    throw new GstEngineError("INVALID_AMOUNT", "commission rate must be between 0 and 1");
  }
  const taxablePaise = toPaise(taxableInr);
  const rateUnits = Math.round(Number((commissionRate * 10_000).toPrecision(15)));
  const commissionPaise = Number(
    (BigInt(taxablePaise) * BigInt(rateUnits) + BigInt(5_000)) / BigInt(10_000)
  );
  return {
    commission_rate: rateUnits / 10_000,
    commission: toInr(commissionPaise),
    venue_payout: toInr(taxablePaise - commissionPaise),
  };
}

/** Rounds INR to the paisa, half-up, like a numeric(14,2) cast. */
export function roundInr(inr: number): number {
  return toInr(toPaise(inr));
}

/** Sums INR amounts in integer paise so long lists don't accumulate float error. */
export function sumInr(amounts: Iterable<number>): number {
  let paise = 0;
  for (const a of amounts) paise += toPaise(a);
  return toInr(paise);
}

/** GST at 18% on a taxable amount — used by the client-side ITC calculator. */
export function gstOn(taxableInr: number): number {
  return toInr(pct(toPaise(taxableInr), GST_RATE_PERCENT));
}
