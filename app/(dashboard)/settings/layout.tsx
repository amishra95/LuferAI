import { requireWorkspace } from "@/lib/auth/session";

// Per-request: access depends on the signed-in user.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: LayoutProps<"/settings">) {
  // middleware.ts gates first; this is the authoritative check.
  await requireWorkspace("/settings");
  return children;
}
