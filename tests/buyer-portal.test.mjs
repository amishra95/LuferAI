import { test } from "node:test";
import assert from "node:assert/strict";
import { COST_CENTRE_PATTERN, costCentreLock, receiptState, validateCostCentre } from "../lib/bookings/expense-meta.ts";

test("validateCostCentre trims and accepts the codes the database accepts", () => {
  assert.deepEqual(validateCostCentre("  ENG-BLR "), { ok: true, value: "ENG-BLR" });
  for (const code of ["IR-ROADSHOW", "fin.ops/2026", "A1", "x_y-z.1/2"]) assert.equal(validateCostCentre(code).ok, true, code);
});

test("validateCostCentre rejects what the check constraint would", () => {
  for (const bad of ["", "   ", "A", "-ENG", "ENG BLR", "ENG#1", "x".repeat(33), 42, null]) {
    assert.equal(validateCostCentre(bad).ok, false, String(bad));
  }
  assert.match(validateCostCentre("").error, /Enter a cost centre/);
  // Mirrors bookings_cost_center_check (^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$).
  assert.equal(String(COST_CENTRE_PATTERN), String(/^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$/));
});

test("costCentreLock: editable until exported to finance, never on cancelled bookings", () => {
  assert.equal(costCentreLock("PENDING_APPROVAL", false), null);
  assert.equal(costCentreLock("CONFIRMED", false), null);
  assert.match(costCentreLock("CONFIRMED", true), /exported to finance/);
  assert.match(costCentreLock("SETTLED", true), /exported to finance/);
  assert.match(costCentreLock("CANCELLED", false), /Cancelled/);
});

test("receiptState names every stage instead of a dash", () => {
  assert.deepEqual(
    ["PENDING_APPROVAL", "PENDING", "CONFIRMED", "COMPLETED", "SETTLED", "CANCELLED"].map((s) => receiptState(s, null).label),
    ["Invoice pending", "Invoice pending", "Receipt pending", "Receipt pending", "Receipt pending", "No receipt"]
  );
});

test("receiptState follows the expense export when there is one", () => {
  assert.equal(receiptState("CONFIRMED", "delivered").kind, "available");
  assert.equal(receiptState("CONFIRMED", "mocked").label, "Receipt available");
  assert.equal(receiptState("CONFIRMED", "failed").label, "Export failed");
  // A failed export is reported even if the booking was cancelled afterwards.
  assert.equal(receiptState("CANCELLED", "failed").kind, "failed");
});
