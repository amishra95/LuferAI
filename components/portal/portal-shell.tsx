import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import type { Portal } from "@/lib/auth/roles";
import { dataSource } from "@/lib/data";

export type PortalKey = Portal | "/client/approvals";

/**
 * Frame for the client, property and admin portals. They render inside the
 * dashboard shell (sidebar + header), so this only adds the shared page width,
 * header and the data-source notice.
 */
export function PortalShell({
  title,
  subtitle,
  actions,
  theme,
  children,
}: {
  /** The portal this page belongs to (navigation lives in the dashboard sidebar). */
  portal?: PortalKey;
  title: string;
  subtitle: string;
  /** Page-level actions shown beside the title (e.g. a drawer trigger). */
  actions?: React.ReactNode;
  /** "concierge": the dark luxury scope (app/globals.css), filling the content pane. */
  theme?: "concierge";
  children: React.ReactNode;
}) {
  const source = dataSource();
  const page = (
    <Page>
      <PageHeader
        title={title}
        description={subtitle}
        badge={<NoticePill>{source === "mock" ? "mock data" : source}</NoticePill>}
        actions={actions}
      />
      {children}
    </Page>
  );
  return theme === "concierge" ? <div className="concierge concierge-page flex-1">{page}</div> : page;
}
