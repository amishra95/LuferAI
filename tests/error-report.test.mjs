import { test } from "node:test";
import assert from "node:assert/strict";
import { buildErrorReport } from "../lib/observability/error-report.ts";

const NOW = new Date("2026-10-26T10:00:00Z");
const context = { routerKind: "App Router", routePath: "/app/(dashboard)/client", routeType: "render", renderSource: "react-server-components" };

test("records the error, its digest and the route", () => {
  const err = Object.assign(new Error("boom"), { digest: "123456" });
  const report = buildErrorReport(err, { path: "/client", method: "GET", headers: {} }, context, NOW);
  assert.equal(report.type, "server_error");
  assert.equal(report.time, "2026-10-26T10:00:00.000Z");
  assert.equal(report.digest, "123456");
  assert.equal(report.name, "Error");
  assert.equal(report.message, "boom");
  assert.equal(report.route, "/app/(dashboard)/client");
  assert.equal(report.routeType, "render");
  assert.match(report.stack, /boom/);
});

test("never logs cookies or Authorization, only allow-listed headers", () => {
  const report = buildErrorReport(
    new Error("x"),
    { path: "/api/bookings", method: "POST", headers: { cookie: "sb-access-token=secret", authorization: "Bearer secret", "user-agent": "UA", "x-vercel-id": "bom1::abc" } },
    context,
    NOW,
  );
  assert.deepEqual(report.headers, { "user-agent": "UA", "x-vercel-id": "bom1::abc" });
  assert.doesNotMatch(JSON.stringify(report), /secret/);
});

test("drops query strings and masks RSVP and vendor quote tokens in the path", () => {
  const at = (path) => buildErrorReport(new Error("x"), { path, method: "GET", headers: {} }, context, NOW).path;
  assert.equal(at("/auth/callback?code=secret"), "/auth/callback");
  assert.equal(at("/rsvp/secret-token"), "/rsvp/[token]");
  assert.equal(at("/quote/secret-token/accept?x=1"), "/quote/[token]/accept");
  assert.equal(at("/client/events/42"), "/client/events/42");
});

test("handles thrown non-Errors", () => {
  const report = buildErrorReport("plain string", { path: "/", method: "GET", headers: {} }, {}, NOW);
  assert.equal(report.message, "plain string");
  assert.equal(report.name, "string");
  assert.equal(report.digest, undefined);
  assert.equal(report.stack, undefined);
});

test("caps very long stacks", () => {
  const err = new Error("x");
  err.stack = "s".repeat(10_000);
  const report = buildErrorReport(err, { path: "/", method: "GET", headers: {} }, context, NOW);
  assert.equal(report.stack.length, 4_000);
});
