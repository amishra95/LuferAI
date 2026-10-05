import type { Metadata } from "next";

import { requirePortal } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Client Portal" };

// Portal data changes per request (bookings, approvals) — never prerender.
export const dynamic = "force-dynamic";

export default async function Layout({ children }: LayoutProps<"/client">) {
  // middleware.ts gates first; this is the authoritative check.
  await requirePortal("/client");
  return children;
}
