/**
 * One structured log line per server error, from instrumentation.ts (onRequestError).
 *
 * Vercel keeps stdout/stderr as runtime logs, so each error is searchable by `digest`:
 * the "ref …" users see on error pages (app/(dashboard)/error.tsx, app/global-error.tsx).
 * Filter logs on `"type":"server_error"`. Sentry, when configured, gets the same errors (instrumentation.ts).
 *
 * Headers are allow-listed, never copied wholesale: cookies and Authorization carry
 * Supabase sessions and API tokens, and Referer can be an RSVP link.
 *
 * No server-only imports or path aliases, so tests can import it directly
 * (tests/error-report.test.mjs).
 */

import { safePath } from "./redact.ts";

export interface RequestInfo {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface ErrorContext {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  revalidateReason?: string;
}

const SAFE_HEADERS = ["user-agent", "x-vercel-id", "x-vercel-ip-country", "x-forwarded-host"];
const MAX_STACK = 4_000;

export function buildErrorReport(error: unknown, request: RequestInfo, context: ErrorContext, now: Date = new Date()) {
  const err = error instanceof Error ? error : null;
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  const headers: Record<string, string> = {};
  for (const name of SAFE_HEADERS) {
    const value = request.headers[name];
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return {
    type: "server_error" as const,
    time: now.toISOString(),
    digest,
    name: err?.name ?? typeof error,
    message: err?.message ?? String(error),
    stack: err?.stack?.slice(0, MAX_STACK),
    method: request.method,
    path: safePath(request.path),
    route: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
    deployment: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    headers,
  };
}
