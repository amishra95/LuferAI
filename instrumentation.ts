import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

import { buildErrorReport } from "./lib/observability/error-report";
import { serverDsn, sharedOptions } from "./lib/observability/sentry";

// Sentry runs only once a DSN is configured (lib/observability/sentry.ts).
export function register() {
  const dsn = serverDsn();
  if (dsn) Sentry.init({ dsn, ...sharedOptions(process.env.VERCEL_ENV) });
}

// Every uncaught server error (Server Components, Route Handlers, Server Actions, proxy)
// becomes one JSON line in the Vercel runtime logs (lib/observability/error-report.ts),
// and a Sentry issue when Sentry is on.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(JSON.stringify(buildErrorReport(error, request, context)));
  if (serverDsn()) Sentry.captureRequestError(error, request, context);
};
