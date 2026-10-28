import { requireWorkspace } from "@/lib/auth/session";

// Per-request: access depends on the signed-in user.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: LayoutProps<"/control-tower">) {
  // proxy.ts gates first; this is the authoritative check.
  await requireWorkspace("/control-tower");
  return children;
}
