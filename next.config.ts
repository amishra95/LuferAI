import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Compiles "use workflow" / "use step" (workflows/channel-reply.ts).
export default withWorkflow(nextConfig);
