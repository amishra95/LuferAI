import type { Metadata } from "next";

import { requirePortal } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Partner extranet" };

// Per-request: listings, rates and access depend on the signed-in user.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: LayoutProps<"/partner">) {
  // middleware.ts gates first; this is the authoritative check.
  await requirePortal("/partner");
  return children;
}
