import type { Metadata } from "next";

import { AdminTabs } from "@/components/admin/admin-tabs";
import { RequestQueue } from "@/components/admin/request-queue";
import { PortalShell } from "@/components/portal/portal-shell";
import { requirePortal } from "@/lib/auth/session";
import { listAllRequests } from "@/lib/concierge/request-store";
import { dataSource } from "@/lib/data";

export const metadata: Metadata = { title: "Concierge queue" };

/** The concierge's queue: quote requests and event briefs, open ones first. */
export default async function RequestsPage() {
  await requirePortal("/admin");
  const requests = dataSource() === "supabase" ? await listAllRequests() : [];
  return (
    <PortalShell portal="/admin" title="Concierge queue">
      <AdminTabs current="/admin/requests" />
      <RequestQueue requests={requests} />
    </PortalShell>
  );
}
