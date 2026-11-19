import assert from "node:assert/strict";
import test from "node:test";

import { CompanySetupInput, officeArea, officeAreaKeyOf, setupGaps } from "../lib/companies/setup.ts";

const blank = { officeArea: "" };

test("blank fields mean no office, address or GSTIN", () => {
  const r = CompanySetupInput.parse(blank);
  assert.deepEqual(r, { officeArea: "", billingAddress: null, gstin: null });
});

test("office areas are presets only", () => {
  assert.equal(CompanySetupInput.safeParse({ ...blank, officeArea: "atlantis" }).success, false);
  assert.equal(officeArea("indiranagar")?.label, "Indiranagar");
  assert.equal(officeAreaKeyOf({ office_latitude: 12.97, office_label: "Indiranagar" }), "indiranagar");
  assert.equal(officeAreaKeyOf({ office_latitude: null, office_label: "office" }), null);
});

test("setup checklist", () => {
  const gaps = setupGaps({ hasGstin: false, hasBillingAddress: false, hasOffice: true, approvers: 0, hasPerHeadTiers: false });
  assert.deepEqual(gaps.map((g) => [g.key, g.done]), [["gstin", false], ["address", false], ["office", true], ["approvers", false], ["limits", false]]);
});

test("billing address: trimmed, lines joined with commas, blank means none, 10–500 characters", () => {
  assert.equal(CompanySetupInput.parse({ ...blank, billingAddress: "   " }).billingAddress, null);
  assert.equal(CompanySetupInput.parse({ ...blank, billingAddress: " 4th Floor, Prestige Tech Park\n  Outer Ring Road\nBengaluru 560103 " }).billingAddress, "4th Floor, Prestige Tech Park, Outer Ring Road, Bengaluru 560103");
  const short = CompanySetupInput.safeParse({ ...blank, billingAddress: "Blr" });
  assert.equal(short.success, false);
  assert.match(short.error.issues[0].message, /street, city and PIN/);
});
