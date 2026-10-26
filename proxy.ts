import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16's name for middleware (same API). Proxy always runs on the Node.js runtime.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on all pages so Supabase sessions stay refreshed; updateSession only *gates*
  // /client, /property and /admin. Static assets and images are skipped.
  // .well-known/workflow/ is the Workflow runtime's own endpoints (workflows/*); they must bypass this.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
