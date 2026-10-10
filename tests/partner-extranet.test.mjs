// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPartnerRole, partnerCan, partnerPermissions, wouldOrphanPartner } from "../lib/auth/partner-rbac.ts";
import { fieldErrorsOf, fromPerHead, listingSchema, overlappingRates, quotePerHead, rateCardSchema } from "../lib/partner/validation.ts";
import { canAccess, homeFor, portalFor } from "../lib/auth/roles.ts";

const owner = { role: "PARTNER", partnerRole: "OWNER" };
const manager = { role: "PARTNER", partnerRole: "MANAGER" };
const staff = { role: "PARTNER", partnerRole: "STAFF" };

test("partners reach only /partner, admins every portal", () => {
  assert.equal(canAccess("PARTNER", "/partner"), true);
  for (const p of ["/client", "/property", "/admin"]) assert.equal(canAccess("PARTNER", p), false);
  assert.equal(canAccess("ADMIN", "/partner"), true);
  for (const r of ["CLIENT", "PROPERTY"]) assert.equal(canAccess(r, "/partner"), false);
  assert.equal(homeFor("PARTNER"), "/partner");
  assert.equal(portalFor("/partner/rates"), "/partner");
  assert.equal(portalFor("/partners"), null);
});

test("owners can do everything, including the team", () => {
  for (const p of ["partner.view", "listing.status", "listing.edit", "rates.edit", "audit.view", "team.manage"]) {
    assert.equal(partnerCan(owner, p), true, p);
  }
});

test("managers run listings and rates but not the team", () => {
  assert.equal(partnerCan(manager, "listing.edit"), true);
  assert.equal(partnerCan(manager, "rates.edit"), true);
  assert.equal(partnerCan(manager, "audit.view"), true);
  assert.equal(partnerCan(manager, "team.manage"), false);
});

test("staff are read-only apart from pausing a listing and fulfilling orders", () => {
  assert.deepEqual([...partnerPermissions(staff)].sort(), ["listing.status", "orders.fulfil", "partner.view"]);
  assert.equal(partnerCan(staff, "rates.edit"), false);
  assert.equal(partnerCan(staff, "listing.edit"), false);
  assert.equal(partnerCan(staff, "catalog.edit"), false);
});

test("admins hold every partner permission; other portal roles none", () => {
  assert.equal(partnerCan({ role: "ADMIN", partnerRole: null }, "team.manage"), true);
  for (const role of ["CLIENT", "PROPERTY", null, undefined]) {
    assert.equal(partnerCan({ role, partnerRole: "OWNER" }, "partner.view"), false, String(role));
  }
  assert.equal(partnerCan({ role: "PARTNER", partnerRole: null }, "partner.view"), false);
  assert.equal(isPartnerRole("MANAGER"), true);
  assert.equal(isPartnerRole("ADMIN"), false);
});

test("a team change may never leave the partner without an owner", () => {
  const team = [
    { userId: "a", partnerRole: "OWNER" },
    { userId: "b", partnerRole: "MANAGER" },
  ];
  assert.equal(wouldOrphanPartner(team, { userId: "a", nextRole: "MANAGER" }), true, "demote the last owner");
  assert.equal(wouldOrphanPartner(team, { userId: "a", nextRole: null }), true, "remove the last owner");
  assert.equal(wouldOrphanPartner(team, { userId: "b", nextRole: null }), false);
  assert.equal(wouldOrphanPartner(team, { userId: "b", nextRole: "OWNER" }), false);
  const twoOwners = [...team, { userId: "c", partnerRole: "OWNER" }];
  assert.equal(wouldOrphanPartner(twoOwners, { userId: "a", nextRole: "STAFF" }), false);
});

test("listing input is trimmed, coerced and bounded like the database", () => {
  const ok = listingSchema.safeParse({ ref: "BVX-200", name: " Garden Hall ", area: "Jayanagar", city: "Bengaluru", capacity: "120", min_spend_inr: "50000" });
  assert.equal(ok.success, true);
  assert.equal(ok.data.name, "Garden Hall");
  assert.equal(ok.data.capacity, 120);
  assert.equal(ok.data.private_dining, false);

  const bad = listingSchema.safeParse({ ref: "has space", name: "G", area: "J", city: "Bengaluru", capacity: "0", min_spend_inr: "-1" });
  assert.equal(bad.success, false);
  const errors = fieldErrorsOf(bad.error);
  assert.deepEqual(Object.keys(errors).sort(), ["area", "capacity", "min_spend_inr", "name", "ref"]);
});

test("rate cards need a positive rate and an end on or after the start", () => {
  const base = { partner_venue_id: "0b9a4c6e-1f2d-4e3a-9b8c-7d6e5f4a3b2c", label: "Weekday", per_head_inr: "1800", min_guests: "1", valid_from: "2026-11-01" };
  assert.equal(rateCardSchema.safeParse(base).data.valid_to, null);
  const backwards = rateCardSchema.safeParse({ ...base, valid_to: "2026-10-31" });
  assert.equal(backwards.success, false);
  assert.equal(fieldErrorsOf(backwards.error).valid_to, "Ends before it starts");
  assert.equal(rateCardSchema.safeParse({ ...base, per_head_inr: "0" }).success, false);
});

const L = "listing-1";
const rates = [
  { id: "r1", partner_venue_id: L, per_head_inr: 2000, min_guests: 1, valid_from: "2026-01-01", valid_to: null },
  { id: "r2", partner_venue_id: L, per_head_inr: 1700, min_guests: 50, valid_from: "2026-01-01", valid_to: "2026-12-31" },
  { id: "r3", partner_venue_id: L, per_head_inr: 2400, min_guests: 1, valid_from: "2025-01-01", valid_to: "2025-12-31" },
  { id: "x", partner_venue_id: "other", per_head_inr: 900, min_guests: 1, valid_from: "2026-01-01", valid_to: null },
];

test("overlaps are refused within a guest bracket, allowed across brackets", () => {
  const sameBracket = { partner_venue_id: L, per_head_inr: 1900, min_guests: 1, valid_from: "2026-06-01", valid_to: "2026-06-30" };
  assert.deepEqual(overlappingRates(rates, sameBracket).map((r) => r.id), ["r1"]);
  assert.deepEqual(overlappingRates(rates, { ...sameBracket, min_guests: 20 }), []);
  assert.deepEqual(overlappingRates(rates, { ...sameBracket, id: "r1" }), [], "editing a card doesn't clash with itself");
  const lastYear = { ...sameBracket, valid_from: "2024-01-01", valid_to: "2024-12-31" };
  assert.deepEqual(overlappingRates(rates, lastYear), []);
});

test("quotes use the most specific active bracket the group qualifies for", () => {
  assert.equal(quotePerHead(rates, L, "2026-07-01", 20), 2000);
  assert.equal(quotePerHead(rates, L, "2026-07-01", 60), 1700);
  assert.equal(quotePerHead(rates, L, "2027-02-01", 60), 2000, "the 50+ rate has ended");
  assert.equal(quotePerHead(rates, L, "2025-06-01", 10), 2400);
  assert.equal(quotePerHead(rates, L, "2024-06-01", 10), null);
  assert.equal(fromPerHead(rates, L, "2026-07-01"), 1700);
});
