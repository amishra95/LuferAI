import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// Note: Next.js 16 deprecates `middleware.ts` in favour of `proxy.ts` (same API).
// To migrate: rename this file to proxy.ts and the export to `proxy`.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on all pages so Supabase sessions stay refreshed; updateSession only *gates*
  // /client, /property and /admin. Static assets and images are skipped.
  // .well-known/workflow/ is the Workflow runtime's own endpoints (workflows/*); they must bypass this.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
