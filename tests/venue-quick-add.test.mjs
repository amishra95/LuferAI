import assert from "node:assert/strict";
import test from "node:test";

import { VenueQuickAdd } from "../lib/admin/venue-quick-add.ts";

const base = {
  name: "Toit",
  area: "indiranagar",
  address: "298, 100 Feet Road, Indiranagar",
  capacity: "120",
  privateRoom: true,
  servesAlcohol: true,
  minSpend: "",
  gstin: "",
  packages: [
    { name: "Team dinner", perHead: "1800", dietary: ["vegetarian"] },
    { name: "", perHead: "", dietary: [] },
  ],
  managerEmail: "",
  managerName: "",
};

test("without a GSTIN a venue is saved unlisted; area sets locality and coordinates", () => {
  const v = VenueQuickAdd.parse(base);
  assert.equal(v.publish, false);
  assert.equal(v.neighborhood, "Indiranagar");
  assert.ok(v.latitude > 12 && v.longitude > 77);
  assert.equal(v.capacity, 120);
  assert.equal(v.minSpend, 0);
  assert.deepEqual(v.packages, [{ name: "Team dinner", perHead: 1800, dietary: ["vegetarian"] }]);
});

test("a valid GSTIN publishes; an invalid one is refused", () => {
  // 29AAACR5055K1Z3: a well-formed Karnataka GSTIN (checksum ok).
  const ok = VenueQuickAdd.parse({ ...base, gstin: " 29aaacr5055k1z3 " });
  assert.equal(ok.publish, true);
  assert.equal(ok.gstin, "29AAACR5055K1Z3");
  assert.equal(VenueQuickAdd.safeParse({ ...base, gstin: "29ABCDE1234F1Z0" }).success, false);
});

test("a package needs both name and price; a manager needs a name", () => {
  assert.equal(VenueQuickAdd.safeParse({ ...base, packages: [{ name: "Lunch", perHead: "", dietary: [] }] }).success, false);
  assert.equal(VenueQuickAdd.safeParse({ ...base, packages: [{ name: "", perHead: "900", dietary: [] }] }).success, false);
  assert.equal(VenueQuickAdd.safeParse({ ...base, managerEmail: "gm@toit.in" }).success, false);
  assert.equal(VenueQuickAdd.safeParse({ ...base, managerEmail: "gm@toit.in", managerName: "Ravi" }).success, true);
  assert.equal(VenueQuickAdd.safeParse({ ...base, area: "" }).success, false);
});
