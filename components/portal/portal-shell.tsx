import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { dataSource } from "@/lib/data";

/**
 * Frame for the client, property and admin portals. They render inside the
 * dashboard shell (sidebar + header), so this only adds the shared page width,
 * header and the data-source notice.
 */
export function PortalShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const source = dataSource();
  return (
    <Page>
      <PageHeader
        title={title}
        description={subtitle}
        badge={<NoticePill>{source === "mock" ? "mock data" : "supabase"}</NoticePill>}
        actions={actions}
      />
      {children}
    </Page>
  );
}
