import assert from "node:assert/strict";
import test from "node:test";

import { CompanySetupInput, officeArea, officeAreaKeyOf, setupGaps } from "../lib/companies/setup.ts";

const blank = { officeArea: "", autoApprovePerHead: "", managerPerHead: "", maxPerHead: "", maxDistanceKm: "" };

test("blank fields mean no limit and no office", () => {
  const r = CompanySetupInput.parse(blank);
  assert.deepEqual(r, { officeArea: "", autoApprovePerHead: null, managerPerHead: null, maxPerHead: null, maxDistanceKm: null, gstin: null });
});

test("per-head limits parse from form strings and must not decrease", () => {
  const ok = CompanySetupInput.parse({ ...blank, autoApprovePerHead: "1500", managerPerHead: "3000", maxPerHead: "5000", maxDistanceKm: "10" });
  assert.equal(ok.autoApprovePerHead, 1500);
  assert.equal(ok.maxDistanceKm, 10);
  assert.equal(CompanySetupInput.safeParse({ ...blank, autoApprovePerHead: "3000", managerPerHead: "1500" }).success, false);
  // A gap in the middle still compares the ones that are set.
  assert.equal(CompanySetupInput.safeParse({ ...blank, autoApprovePerHead: "3000", maxPerHead: "2000" }).success, false);
  assert.equal(CompanySetupInput.safeParse({ ...blank, managerPerHead: "-1" }).success, false);
});

test("office areas are presets only", () => {
  assert.equal(CompanySetupInput.safeParse({ ...blank, officeArea: "atlantis" }).success, false);
  assert.equal(officeArea("indiranagar")?.label, "Indiranagar");
  assert.equal(officeAreaKeyOf({ office_latitude: 12.97, office_label: "Indiranagar" }), "indiranagar");
  assert.equal(officeAreaKeyOf({ office_latitude: null, office_label: "office" }), null);
});

test("setup checklist", () => {
  const gaps = setupGaps({ hasGstin: false, hasOffice: true, approvers: 0, hasPerHeadTiers: false });
  assert.deepEqual(gaps.map((g) => [g.key, g.done]), [["gstin", false], ["office", true], ["approvers", false], ["limits", false]]);
});
