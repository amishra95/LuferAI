import type { Metadata } from "next";

import { PropertyUserManager } from "@/components/admin/property-user-manager";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { PortalShell } from "@/components/portal/portal-shell";
import { listPropertyManagers, ManagerError, type PropertyManager } from "@/lib/admin/property-managers";
import { requirePortal } from "@/lib/auth/session";
import { listVenues } from "@/lib/data";

export const metadata: Metadata = { title: "Property managers" };

export default async function PropertyManagersPage() {
  await requirePortal("/admin");
  const venues = await listVenues();
  let managers: PropertyManager[] = [];
  let unavailable: string | null = null;
  try {
    managers = await listPropertyManagers();
  } catch (err) {
    if (!(err instanceof ManagerError)) throw err;
    unavailable = err.message;
  }

  return (
    <PortalShell portal="/admin" title="Property managers & venue assignments" subtitle="Who runs each venue's property portal and receives its booking requests.">
      <AdminTabs current="/admin/managers" />
      {unavailable ? (
        <p role="note" className="panel text-fg-subtle p-6 text-meta">
          {unavailable}
        </p>
      ) : (
        <PropertyUserManager managers={managers} venues={venues.map((v) => ({ id: v.id, name: v.name, area: v.neighborhood }))} />
      )}
    </PortalShell>
  );
}
