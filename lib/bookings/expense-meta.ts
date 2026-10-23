/**
 * A booking's expense metadata on the client portal: validating a cost centre
 * typed into the bookings table, when it may still change, and what the
 * Receipt column says for each lifecycle stage.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/buyer-portal.test.mjs).
 */

/** Same rule as the bookings.cost_center check constraint (migration 20261007130000). */
export const COST_CENTRE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$/;

export type CostCentreResult = { ok: true; value: string } | { ok: false; error: string };

export function validateCostCentre(raw: unknown): CostCentreResult {
  if (typeof raw !== "string") return { ok: false, error: "Enter a cost centre." };
  // Stored uppercase, like the booking request form (lib/bookings/expense.ts), so one code never appears twice.
  const value = raw.trim().toUpperCase();
  if (!value) return { ok: false, error: "Enter a cost centre." };
  if (!COST_CENTRE_PATTERN.test(value)) {
    return { ok: false, error: "Use 2–32 letters, digits, dots, dashes, slashes or underscores, starting with a letter or digit." };
  }
  return { ok: true, value };
}

/**
 * Why a booking's cost centre can't change any more, or null when it can. Once
 * the receipt is exported, finance has the code; changing it here would make
 * the two disagree.
 */
export function costCentreLock(bookingStatus: string, exported: boolean): string | null {
  if (exported) return "Locked: the receipt has already been exported to finance with this cost centre.";
  if (bookingStatus === "CANCELLED") return "Cancelled bookings keep the cost centre they had.";
  return null;
}

export type ReceiptKind = "available" | "failed" | "pending" | "awaiting" | "none";

export interface ReceiptState {
  kind: ReceiptKind;
  label: string;
  /** One sentence for the tooltip. */
  hint: string;
}

/** The Receipt column for a booking, from its status and its expense export (if any). */
export function receiptState(bookingStatus: string, exportStatus: string | null): ReceiptState {
  if (exportStatus === "failed" || exportStatus === "dead_lettered") return { kind: "failed", label: "Export failed", hint: "The receipt couldn't be delivered to your expense system. An Approver can retry the sync." };
  if (exportStatus) return { kind: "available", label: "Receipt available", hint: "Exported to finance. Download the structured receipt (JSON)." };
  if (bookingStatus === "CANCELLED") return { kind: "none", label: "No receipt", hint: "Cancelled, so no invoice or receipt was issued." };
  if (bookingStatus === "CONFIRMED" || bookingStatus === "COMPLETED" || bookingStatus === "SETTLED") {
    return { kind: "pending", label: "Receipt pending", hint: "Confirmed; the receipt hasn't been exported to finance yet." };
  }
  return { kind: "awaiting", label: "Invoice pending", hint: "The invoice and receipt are issued once the venue confirms." };
}
