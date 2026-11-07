import type { Metadata } from "next";

import { PortalShell } from "@/components/portal/portal-shell";
import { requirePortal } from "@/lib/auth/session";
import { QuickAddForm } from "./quick-add-form";

export const metadata: Metadata = { title: "Add a venue" };

export default async function AddVenuePage() {
  await requirePortal("/admin");
  return (
    <PortalShell portal="/admin" title="Add a venue">
      <QuickAddForm />
    </PortalShell>
  );
}
