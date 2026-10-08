// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccess, canAccessWorkspace, homeFor, portalFor, safeNextPath, workspaceRouteFor } from "../lib/auth/roles.ts";

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

test("admin-only workspace areas admit admins only", () => {
  for (const r of ["/dashboard", "/settings", "/agents"]) {
    assert.equal(canAccessWorkspace("ADMIN", null, r), true);
    assert.equal(canAccessWorkspace("CLIENT", "ORGANIZER", r), false);
    assert.equal(canAccessWorkspace("CLIENT", "APPROVER", r), false);
    assert.equal(canAccessWorkspace("PROPERTY", null, r), false);
  }
});

test("venues admits admins and client bookers, not finance viewers", () => {
  assert.equal(canAccessWorkspace("ADMIN", null, "/venues"), true);
  assert.equal(canAccessWorkspace("CLIENT", "ORGANIZER", "/venues"), true);
  assert.equal(canAccessWorkspace("CLIENT", "APPROVER", "/venues"), true);
  assert.equal(canAccessWorkspace("CLIENT", "FINANCE_VIEWER", "/venues"), false);
});

test("chat admits admins and every client role (its analytics are company-scoped)", () => {
  for (const c of ["ORGANIZER", "APPROVER", "FINANCE_VIEWER"]) assert.equal(canAccessWorkspace("CLIENT", c, "/chat"), true, c);
  assert.equal(canAccessWorkspace("ADMIN", null, "/chat"), true);
});

test("nobody else reaches chat or venues", () => {
  for (const r of ["/chat", "/venues"]) {
    assert.equal(canAccessWorkspace("CLIENT", null, r), false);
    assert.equal(canAccessWorkspace("PROPERTY", null, r), false);
    assert.equal(canAccessWorkspace("PARTNER", null, r), false);
    assert.equal(canAccessWorkspace(null, null, r), false);
  }
});

test("workspaceRouteFor matches the area and its sub-paths only", () => {
  assert.equal(workspaceRouteFor("/settings"), "/settings");
  assert.equal(workspaceRouteFor("/chat/abc"), "/chat");
  assert.equal(workspaceRouteFor("/settingsx"), null);
  assert.equal(workspaceRouteFor("/client"), null);
});

import { membershipFromClaims } from "../lib/auth/roles.ts";

test("membershipFromClaims reads app_metadata.lufer from the hook, and nothing malformed", () => {
  const claims = (lufer) => ({ sub: "u1", role: "authenticated", app_metadata: { provider: "email", lufer } });
  assert.deepEqual(membershipFromClaims(claims({ v: 1, role: "CLIENT", company_id: "c1", corporate_role: "APPROVER" })), { role: "CLIENT", corporateRole: "APPROVER" });
  assert.deepEqual(membershipFromClaims(claims({ v: 1, role: "ADMIN" })), { role: "ADMIN", corporateRole: null });
  assert.deepEqual(membershipFromClaims(claims({ v: 1, role: "CLIENT", corporate_role: "OWNER" })), { role: "CLIENT", corporateRole: null });
  assert.equal(membershipFromClaims(claims(undefined)), null); // hook not enabled
  assert.equal(membershipFromClaims(claims({ v: 2, role: "ADMIN" })), null); // unknown shape: look it up instead
  assert.equal(membershipFromClaims(claims({ v: 1, role: "SUPERUSER" })), null);
  assert.equal(membershipFromClaims({ sub: "u1", lufer: { v: 1, role: "ADMIN" } }), null); // only app_metadata counts
  assert.equal(membershipFromClaims(null), null);
});
