import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { getCurrentMember } from "@/lib/auth/session";
import type { Portal } from "@/lib/auth/roles";
import { dataSource } from "@/lib/data";

export type PortalKey = Portal | "/client/approvals";

/**
 * Frame for the client, property and admin portals. They render inside the
 * dashboard shell (sidebar + header), so this only adds the shared page width,
 * header and the data-source notice (admins). Moving between sides and
 * sections is the sidebar's job.
 */
export async function PortalShell({
  title,
  subtitle,
  actions,
  children,
}: {
  /** The portal this page belongs to; the sidebar picks the side from the URL. */
  portal?: PortalKey;
  title: string;
  subtitle: string;
  /** Page-level actions shown beside the title (e.g. a drawer trigger). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const source = dataSource();
  // Operator-only chrome: the data-source badge.
  const admin = (await getCurrentMember())?.role === "ADMIN";
  return (
    <Page>
      <PageHeader
        title={title}
        description={subtitle}
        badge={admin ? <NoticePill>{source === "mock" ? "mock data" : source}</NoticePill> : undefined}
        actions={actions}
      />
      {children}
    </Page>
  );
}
