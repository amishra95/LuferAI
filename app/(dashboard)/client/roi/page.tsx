import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TrendingUp } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { StatCard } from "@/components/portal/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePortal } from "@/lib/auth/session";
import { dealRoi } from "@/lib/crm/deals";
import { dealsAvailable, listDeals } from "@/lib/crm/store";
import { listBookings, listCompanies, listPortalUsers } from "@/lib/data";
import { formatDate, formatINR } from "@/lib/utils";
import { DealSelect, ImportDealsForm } from "./_components/deal-controls";

export const metadata: Metadata = { title: "Entertainment ROI" };

const SPEND = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const STAGE: Record<string, { label: string; variant: "success" | "secondary" | "outline" }> = {
  won: { label: "Won", variant: "success" },
  lost: { label: "Lost", variant: "outline" },
  open: { label: "Open", variant: "secondary" },
};

export default async function RoiPage({ searchParams }: PageProps<"/client/roi">) {
  const member = await requirePortal("/client");
  const { company: companyParam } = await searchParams;
  const all = await listCompanies();
  const companies = member.role === "ADMIN" ? all : all.filter((c) => c.id === member.companyId);
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  const [deals, bookings, users] = await Promise.all([listDeals(company.id), listBookings({ companyId: company.id }), listPortalUsers({ companyId: company.id })]);
  const actor = users.find((u) => u.id === member.userId);
  const canEdit = member.role === "CLIENT" && (actor?.role === "ORGANIZER" || actor?.role === "APPROVER") && dealsAvailable();

  const spendBookings = bookings.filter((b) => SPEND.has(b.status));
  // Redis/mock bookings have no crm_deal_id column.
  const dealOf = (b: (typeof bookings)[number]) => b.crm_deal_id ?? null;
  const roi = dealRoi(
    deals,
    spendBookings.map((b) => ({ id: b.id, crm_deal_id: dealOf(b), status: b.status, spend_inr: b.invoice.invoice_total })),
  );
  const options = deals.map((d) => ({ id: d.id, label: `${d.name}${d.account_name ? ` · ${d.account_name}` : ""}${d.stage !== "open" ? ` (${STAGE[d.stage].label})` : ""}` }));
  const shortName = company.legal_name.replace(" Private Limited", "");

  return (
    <PortalShell portal="/client" title="Entertainment ROI" subtitle={`${shortName} · what client entertainment did for sales`}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Won revenue entertained" value={formatINR(roi.wonRevenue)} hint={`on ${formatINR(roi.wonSpend)} of entertainment`} />
          <StatCard label="Revenue per ₹1 spent" value={roi.roiMultiple === null ? "—" : `₹${roi.roiMultiple.toLocaleString("en-IN")}`} hint="won revenue ÷ all linked spend" />
          <StatCard label="Open pipeline entertained" value={formatINR(roi.influencedPipeline)} />
          <StatCard label="Win rate" value={pct(roi.winRate)} hint={`vs ${pct(roi.baselineWinRate)} for deals without entertainment`} />
        </div>
        <p className="text-xs text-fg-subtle">
          Spend linked to deals {formatINR(roi.linkedSpend)} · not linked {formatINR(roi.unlinkedSpend)}. Spend is confirmed bookings including GST.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Deals</CardTitle>
            <CardDescription>
              Import a deals export from Zoho CRM, HubSpot or Salesforce. Re-import any time; existing deals update by their CRM id.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!dealsAvailable() ? (
              <p className="text-sm text-fg-muted">Deals need the live database.</p>
            ) : canEdit ? (
              <ImportDealsForm />
            ) : (
              <p className="text-sm text-fg-muted">Organizers and Approvers can import deals and link bookings.</p>
            )}
            {roi.deals.length === 0 ? (
              <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-line p-8 text-center">
                <TrendingUp className="size-6 text-fg-subtle" aria-hidden />
                <p className="text-sm text-fg-muted">No deals yet. Export deals from your CRM as CSV and import them here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Bookings</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Return</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roi.deals.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <div className="font-medium">{d.name}</div>
                          {d.account_name && <div className="text-xs text-fg-subtle">{d.account_name}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STAGE[d.stage].variant}>{STAGE[d.stage].label}</Badge>
                          {d.closed_on && <div className="text-xs text-fg-subtle">{formatDate(d.closed_on)}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(d.amount_inr)}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.bookings}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(d.spend)}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.multiple === null ? "—" : `${d.multiple.toLocaleString("en-IN")}×`}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bookings</CardTitle>
            <CardDescription>Pick the deal each event entertained for.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {spendBookings.length === 0 ? (
              <p className="text-sm text-fg-muted">No confirmed bookings yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Venue</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead>Deal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spendBookings.slice(0, 200).map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/client/events/${b.id}`} className="hover:underline">
                          {formatDate(b.event_date)}
                        </Link>
                      </TableCell>
                      <TableCell>{b.venue.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(b.invoice.invoice_total)}</TableCell>
                      <TableCell>
                        <DealSelect bookingId={b.id} value={dealOf(b)} deals={options} disabled={!canEdit || deals.length === 0} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}
