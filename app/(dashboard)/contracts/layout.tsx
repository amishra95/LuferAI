import { requireWorkspace } from "@/lib/auth/session";

// Per-request: access depends on the signed-in user.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: LayoutProps<"/contracts">) {
  // middleware.ts gates first; this is the authoritative check. Each contract page checks it's the member's.
  await requireWorkspace("/contracts");
  return children;
}
