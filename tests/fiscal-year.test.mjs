// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, financialYear } from "../lib/fiscal-year.ts";

test("Indian financial year runs April to March", () => {
  assert.deepEqual(financialYear("2026-10-05"), { start: "2026-04-01", end: "2027-03-31", label: "FY26–27" });
  assert.deepEqual(financialYear("2027-03-31"), { start: "2026-04-01", end: "2027-03-31", label: "FY26–27" });
  assert.equal(financialYear("2027-04-01").start, "2027-04-01");
});

test("daysBetween counts whole calendar days", () => {
  assert.equal(daysBetween("2026-10-05", "2026-10-12"), 7);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
});
