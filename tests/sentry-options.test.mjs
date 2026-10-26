import { test } from "node:test";
import assert from "node:assert/strict";
import { safePath, safeUrl, scrubDeep, scrubText } from "../lib/observability/redact.ts";
import { scrubBreadcrumb, scrubEvent, serverDsn, sharedOptions } from "../lib/observability/sentry.ts";

test("safeUrl keeps the origin, drops query and fragment, and masks tokens", () => {
  assert.equal(safeUrl("https://lufer.ai/rsvp/secret?x=1#y"), "https://lufer.ai/rsvp/[token]");
  assert.equal(safeUrl("https://lufer.ai/client/events/42?tab=guests"), "https://lufer.ai/client/events/42");
  assert.equal(safeUrl("/quote/secret/accept#top"), "/quote/[token]/accept");
  assert.equal(safePath("/rsvp/secret"), "/rsvp/[token]");
});

test("scrubEvent removes cookies, auth headers, bodies and query strings", () => {
  const event = scrubEvent({
    request: {
      url: "https://lufer.ai/rsvp/secret?code=abc",
      query_string: "code=abc",
      cookies: { "sb-access-token": "secret" },
      data: { guests: ["a@example.com"] },
      headers: { Cookie: "secret", Authorization: "Bearer secret", Referer: "https://lufer.ai/rsvp/secret", "User-Agent": "UA" },
    },
    breadcrumbs: [{ data: { url: "https://lufer.ai/quote/secret?x=1", from: "/rsvp/secret", to: "/client" } }, {}],
  });
  assert.equal(event.request.url, "https://lufer.ai/rsvp/[token]");
  assert.deepEqual(event.request.headers, { "User-Agent": "UA" });
  assert.equal(event.request.query_string, undefined);
  assert.equal(event.request.cookies, undefined);
  assert.equal(event.request.data, undefined);
  assert.deepEqual(event.breadcrumbs[0].data, { url: "https://lufer.ai/quote/[token]", from: "/rsvp/[token]", to: "/client" });
  assert.doesNotMatch(JSON.stringify(event), /secret/);
});

test("scrubBreadcrumb leaves breadcrumbs without data alone", () => {
  assert.deepEqual(scrubBreadcrumb({ message: "clicked" }), { message: "clicked" });
});

test("no default PII, and traces are sampled only in production", () => {
  assert.equal(sharedOptions("production").sendDefaultPii, false);
  assert.equal(sharedOptions("production").tracesSampleRate, 0.1);
  assert.equal(sharedOptions("preview").tracesSampleRate, 1.0);
  assert.equal(sharedOptions(undefined).environment, "development");
});

test("Sentry stays off without a DSN, and the server falls back to the public DSN", () => {
  const saved = { s: process.env.SENTRY_DSN, p: process.env.NEXT_PUBLIC_SENTRY_DSN };
  try {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    assert.equal(serverDsn(), undefined);
    process.env.SENTRY_DSN = "  ";
    assert.equal(serverDsn(), undefined);
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://k@o1.ingest.us.sentry.io/2";
    assert.equal(serverDsn(), "https://k@o1.ingest.us.sentry.io/2");
  } finally {
    for (const [k, v] of [["SENTRY_DSN", saved.s], ["NEXT_PUBLIC_SENTRY_DSN", saved.p]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("scrubText cleans URLs inside free text and leaves other text alone", () => {
  assert.equal(scrubText("GET /api/x?code=secret failed"), "GET /api/x failed");
  assert.equal(scrubText("see https://lufer.ai/rsvp/secret?x=1 now"), "see https://lufer.ai/rsvp/[token] now");
  assert.equal(scrubText("Is this ok?"), "Is this ok?");
  assert.equal(scrubText("a/b and c"), "a/b and c");
});

test("the fields that leaked in a live test are scrubbed: span attributes, nextjs context, transaction", () => {
  const event = scrubEvent({
    transaction: "GET /api/zz-boom?code=secret",
    contexts: { nextjs: { request_path: "/api/zz-boom?code=secret", router_path: "/api/zz-boom" } },
    spans: [{ data: { "url.full": "http://localhost:3123/api/zz-boom?code=secret", "http.target": "/api/zz-boom?code=secret" } }],
  });
  assert.doesNotMatch(JSON.stringify(event), /secret/);
  assert.equal(event.contexts.nextjs.request_path, "/api/zz-boom");
});

test("streamed spans (beforeSendSpan) are scrubbed too", () => {
  const span = {
    name: "GET /rsvp/secret",
    attributes: {
      "url.full": { value: "https://lufer.ai/rsvp/secret?x=1", type: "string" },
      "url.query": { value: "x=secret", type: "string" },
      "user.ip_address": { value: "203.0.113.9", type: "string" },
      "http.request.method": { value: "GET", type: "string" },
    },
  };
  assert.equal(sharedOptions("production").beforeSendSpan, scrubDeep);
  const scrubbed = scrubDeep(span);
  assert.doesNotMatch(JSON.stringify(scrubbed), /secret|203\.0\.113/);
  assert.deepEqual(Object.keys(scrubbed.attributes), ["url.full", "http.request.method"]);
});

test("scrubDeep survives cycles", () => {
  const a = { url: "/x?y=secret" };
  a.self = a;
  scrubDeep(a);
  assert.equal(a.url, "/x");
});
