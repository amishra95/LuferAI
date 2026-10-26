import * as Sentry from "@sentry/nextjs";

import { sharedOptions } from "./lib/observability/sentry";

// Browser errors go to Sentry once NEXT_PUBLIC_SENTRY_DSN is set (lib/observability/sentry.ts).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
if (dsn) Sentry.init({ dsn, ...sharedOptions(process.env.NEXT_PUBLIC_VERCEL_ENV) });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
