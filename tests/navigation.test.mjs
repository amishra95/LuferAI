import { test } from "node:test";
import assert from "node:assert/strict";

import { allSides, isItemActive, sideForPath, sideForRole, sideHome, sideSections, visibleSides } from "../components/dashboard/nav-config.ts";

const hrefs = (side, allowed) => sideSections(side, allowed).flatMap((s) => s.items.map((i) => i.href));

test("pages belong to a side; shared pages don't", () => {
  assert.equal(sideForPath("/client"), "company");
  assert.equal(sideForPath("/client/events/123"), "company");
  assert.equal(sideForPath("/governance"), "company");
  assert.equal(sideForPath("/property"), "venue");
  assert.equal(sideForPath("/partner"), "venue");
  assert.equal(sideForPath("/admin/analytics"), "operator");
  assert.equal(sideForPath("/dashboard"), "operator");
  for (const shared of ["/venues", "/chat", "/contracts"]) assert.equal(sideForPath(shared), null);
  assert.equal(sideForRole("CLIENT"), "company");
  assert.equal(sideForRole("PROPERTY"), "venue");
  assert.equal(sideForRole("PARTNER"), "venue");
  assert.equal(sideForRole("ADMIN"), "operator");
});

test("each role sees one side, and only its own items there", () => {
  const client = ["/client", "/venues", "/chat", "/governance", "/contracts"];
  assert.deepEqual(visibleSides(client), ["company"]);
  assert.ok(!hrefs("company", client).includes("/client/approvals"), "approvals only for approvers");
  assert.ok(hrefs("company", [...client, "/client/approvals"]).includes("/client/approvals"));
  assert.equal(sideHome("company", client), "/client");

  const property = ["/property", "/contracts"];
  assert.deepEqual(visibleSides(property), ["venue"]);
  assert.ok(hrefs("venue", property).every((h) => h.startsWith("/property") || h === "/contracts"), "no partner items for a property manager");

  // Partner staff: no team, activity or payouts unless their role grants them.
  const staff = ["/partner"];
  assert.deepEqual(hrefs("venue", staff), ["/partner", "/partner?tab=rates", "/partner?tab=catalog", "/partner?tab=orders"]);
  const owner = ["/partner", "/partner?tab=payouts", "/partner?tab=team", "/partner?tab=activity"];
  assert.ok(hrefs("venue", owner).includes("/partner?tab=team"));
  assert.equal(sideHome("venue", staff), "/partner");
});

test("admins can view every side", () => {
  const admin = ["/client", "/property", "/partner", "/admin", "/dashboard", "/settings", "/agents", "/chat", "/venues", "/governance", "/contracts", "/client/approvals", "/admin/approvals", "/admin/managers", "/admin/analytics"];
  assert.deepEqual(visibleSides(admin), ["company", "venue", "operator"]);
  assert.equal(sideHome("venue", admin), "/property");
  assert.equal(sideHome("operator", admin), "/dashboard");
});

test("admins get every side in one sidebar, each page listed once", () => {
  const admin = ["/client", "/property", "/partner", "/admin", "/dashboard", "/settings", "/agents", "/chat", "/venues", "/governance", "/contracts", "/client/approvals", "/admin/approvals", "/admin/managers", "/admin/analytics", "/partner?tab=payouts", "/partner?tab=team", "/partner?tab=activity"];
  const groups = allSides(visibleSides(admin), admin);
  assert.deepEqual(groups.map((g) => g.side), ["operator", "company", "venue"]);
  const all = groups.flatMap((g) => g.sections.flatMap((s) => s.items.map((i) => i.href)));
  assert.equal(new Set(all).size, all.length, "no page twice");
  // Every portal and page from before is reachable.
  for (const h of ["/client", "/client/approvals", "/governance", "/property", "/partner", "/admin", "/admin/approvals", "/admin/managers", "/admin/analytics", "/dashboard", "/chat", "/agents", "/venues", "/settings", "/contracts"]) {
    assert.ok(all.includes(h), h);
  }
});

test("the item for the current section is highlighted, tabs included", () => {
  const all = ["/client", "/client?tab=signoffs", "/client/approvals"];
  assert.equal(isItemActive("/client", "/client", null, all), true);
  assert.equal(isItemActive("/client", "/client", "signoffs", all), false);
  assert.equal(isItemActive("/client?tab=signoffs", "/client", "signoffs", all), true);
  // A page below an item without one of its own lights that item up…
  assert.equal(isItemActive("/client", "/client/events/abc", null, all), true);
  // …unless a more specific item owns it.
  assert.equal(isItemActive("/client", "/client/approvals", null, all), false);
  assert.equal(isItemActive("/client/approvals", "/client/approvals", null, all), true);
});
