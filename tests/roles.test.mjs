// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccess, homeFor, portalFor, safeNextPath } from "../lib/auth/roles.ts";

test("client can only open /client", () => {
  assert.equal(canAccess("CLIENT", "/client"), true);
  assert.equal(canAccess("CLIENT", "/property"), false);
  assert.equal(canAccess("CLIENT", "/admin"), false);
});

test("property_manager can only open /property", () => {
  assert.equal(canAccess("PROPERTY", "/property"), true);
  assert.equal(canAccess("PROPERTY", "/admin"), false);
  assert.equal(canAccess("PROPERTY", "/client"), false);
});

test("admin can open every portal", () => {
  for (const p of ["/client", "/property", "/admin"]) assert.equal(canAccess("ADMIN", p), true);
});

test("no role means no access", () => {
  assert.equal(canAccess(null, "/client"), false);
  assert.equal(canAccess(undefined, "/admin"), false);
});

test("portalFor matches the portal and its sub-paths only", () => {
  assert.equal(portalFor("/admin"), "/admin");
  assert.equal(portalFor("/property/bookings/1"), "/property");
  assert.equal(portalFor("/administrator"), null);
  assert.equal(portalFor("/login"), null);
  assert.equal(portalFor("/"), null);
});

test("homeFor sends each role to its own portal", () => {
  assert.equal(homeFor("CLIENT"), "/client");
  assert.equal(homeFor("PROPERTY"), "/property");
  assert.equal(homeFor("ADMIN"), "/admin");
});

test("safeNextPath rejects off-site redirects", () => {
  assert.equal(safeNextPath("/client?company=1"), "/client?company=1");
  assert.equal(safeNextPath("//evil.example"), null);
  assert.equal(safeNextPath("/\\evil.example"), null);
  assert.equal(safeNextPath("https://evil.example"), null);
  assert.equal(safeNextPath(""), null);
});
