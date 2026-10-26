import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

import { DOCUMENT_POLICY, DOCUMENT_ROUTES, securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
          dev: process.env.NODE_ENV === "development",
        }),
      },
      // Later rules win for the same key, so generated documents keep their locked-down policy.
      ...DOCUMENT_ROUTES.map((source) => ({ source, headers: [{ key: "Content-Security-Policy", value: DOCUMENT_POLICY }] })),
    ];
  },
};

// Compiles "use workflow" / "use step" (workflows/channel-reply.ts).
const config = withWorkflow(nextConfig);

// With a Sentry auth token (set by the Vercel Sentry integration), upload source maps so
// stack traces are readable. Without one the build is unchanged; Sentry itself is enabled
// by the DSN at runtime (instrumentation.ts, instrumentation-client.ts).
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      telemetry: false,
    })
  : config;
