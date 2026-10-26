/**
 * Sentry options shared by the server (instrumentation.ts) and the browser
 * (instrumentation-client.ts). Sentry stays off until a DSN is set:
 *   SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN (the Vercel Sentry integration sets both).
 *
 * Privacy: no default PII (IPs, cookies, user bodies). Every event, span and breadcrumb
 * has Cookie / Authorization headers and request bodies removed, then every string in it
 * scrubbed (query strings dropped, /rsvp/<token> and /quote/<token> masked): URLs turn up
 * in many fields (request.url, span attributes url.full / http.target, the nextjs
 * context's request_path, transaction names), so no field list is relied on.
 *
 * Structural types only (no @sentry imports), so tests can import it directly
 * (tests/sentry-options.test.mjs).
 */

import { scrubDeep } from "./redact.ts";

type Headers = Record<string, string>;

interface SentryEventLike {
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: Headers; data?: unknown };
  breadcrumbs?: BreadcrumbLike[];
}

interface BreadcrumbLike {
  data?: Record<string, unknown>;
}

const SECRET_HEADERS = new Set(["cookie", "authorization", "x-supabase-auth", "referer"]);

export function serverDsn(): string | undefined {
  return process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
}

export function scrubBreadcrumb<B extends BreadcrumbLike>(breadcrumb: B): B {
  return scrubDeep(breadcrumb);
}

export function scrubEvent<E extends SentryEventLike>(event: E): E {
  const request = event.request;
  if (request) {
    delete request.query_string;
    delete request.cookies;
    // Request bodies can hold guest lists, quotes and payment details.
    delete request.data;
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (SECRET_HEADERS.has(name.toLowerCase())) delete request.headers[name];
      }
    }
  }
  return scrubDeep(event);
}

/** Options common to every runtime; callers add `dsn` and runtime-specific integrations. */
export function sharedOptions(environment: string | undefined) {
  const production = environment === "production";
  return {
    environment: environment ?? "development",
    sendDefaultPii: false,
    // Errors are always sent; this samples performance traces only.
    tracesSampleRate: production ? 0.1 : 1.0,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeSendSpan: scrubDeep,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
