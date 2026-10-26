import { test } from "node:test";
import assert from "node:assert/strict";
import { CSP_REPORT_PATH, DOCUMENT_POLICY, DOCUMENT_ROUTES, enforcedPolicy, reportOnlyPolicy, securityHeaders } from "../lib/security-headers.ts";

const directives = (policy) => Object.fromEntries(policy.split("; ").map((d) => { const [name, ...sources] = d.split(" "); return [name, sources]; }));
const header = (headers, key) => headers.find((h) => h.key === key)?.value;

test("the enforced policy only blocks framing, <base> and plugins", () => {
  assert.deepEqual(directives(enforcedPolicy()), {
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  });
});

test("the report-only policy allows Supabase over https and wss, and reports violations", () => {
  const d = directives(reportOnlyPolicy({ supabaseUrl: " https://abcd.supabase.co/ " }));
  assert.ok(d["connect-src"].includes("https://abcd.supabase.co"));
  assert.ok(d["connect-src"].includes("wss://abcd.supabase.co"));
  assert.deepEqual(d["report-uri"], [CSP_REPORT_PATH]);
});

test("the report-only policy covers Razorpay Checkout and the maplibre worker", () => {
  const d = directives(reportOnlyPolicy());
  assert.ok(d["script-src"].includes("https://checkout.razorpay.com"));
  assert.ok(d["frame-src"].includes("https://api.razorpay.com"));
  assert.ok(d["worker-src"].includes("blob:"));
  assert.ok(d["connect-src"].includes("https://api.maptiler.com"));
});

test("eval and the HMR websocket are allowed only in development", () => {
  assert.ok(!directives(reportOnlyPolicy())["script-src"].includes("'unsafe-eval'"));
  const dev = directives(reportOnlyPolicy({ dev: true }));
  assert.ok(dev["script-src"].includes("'unsafe-eval'"));
  assert.ok(dev["connect-src"].includes("ws:"));
});

test("an invalid Supabase URL is left out rather than breaking the policy", () => {
  const d = directives(reportOnlyPolicy({ supabaseUrl: "not a url" }));
  assert.ok(!d["connect-src"].some((s) => s.includes("not")));
});

test("HSTS is sent in production but not in development", () => {
  assert.match(header(securityHeaders(), "Strict-Transport-Security"), /max-age=63072000; includeSubDomains/);
  assert.doesNotMatch(header(securityHeaders(), "Strict-Transport-Security"), /preload/);
  assert.equal(header(securityHeaders({ dev: true }), "Strict-Transport-Security"), undefined);
});

test("the baseline headers are always present", () => {
  const headers = securityHeaders();
  assert.equal(header(headers, "X-Frame-Options"), "DENY");
  assert.equal(header(headers, "X-Content-Type-Options"), "nosniff");
  assert.equal(header(headers, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(header(headers, "Permissions-Policy"), /camera=\(\)/);
});

test("generated documents get a policy that blocks everything but inline styles", () => {
  const d = directives(DOCUMENT_POLICY);
  assert.deepEqual(d["default-src"], ["'none'"]);
  assert.deepEqual(d["style-src"], ["'unsafe-inline'"]);
  assert.deepEqual(d["frame-ancestors"], ["'none'"]);
  assert.deepEqual(DOCUMENT_ROUTES, ["/api/bookings/:id/tax-invoice", "/api/contracts/:id/document"]);
});
