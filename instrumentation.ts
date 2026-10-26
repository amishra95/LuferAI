import type { Instrumentation } from "next";

import { buildErrorReport } from "./lib/observability/error-report";

// Every uncaught server error (Server Components, Route Handlers, Server Actions, proxy)
// becomes one JSON line in the Vercel runtime logs. See lib/observability/error-report.ts.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(JSON.stringify(buildErrorReport(error, request, context)));
};
