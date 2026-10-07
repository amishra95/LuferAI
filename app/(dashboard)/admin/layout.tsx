import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin Portal" };

// Portal data changes per request (bookings, approvals) — never prerender.
export const dynamic = "force-dynamic";

export default function Layout({ children }: LayoutProps<"/admin">) {
  return children;
}
