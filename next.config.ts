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
          dev: process.env.NODE_ENV === "development",
        }),
      },
      // Later rules win for the same key, so generated documents keep their locked-down policy.
      ...DOCUMENT_ROUTES.map((source) => ({ source, headers: [{ key: "Content-Security-Policy", value: DOCUMENT_POLICY }] })),
    ];
  },
};

// Compiles "use workflow" / "use step" (workflows/channel-reply.ts).
export default withWorkflow(nextConfig);
