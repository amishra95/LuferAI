import { requireWorkspace } from "@/lib/auth/session";

// Per-request: access depends on the signed-in user.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: LayoutProps<"/dashboard">) {
  // middleware.ts gates first; this is the authoritative check.
  await requireWorkspace("/dashboard");
  return children;
}
