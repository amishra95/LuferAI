import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileSpreadsheet, Printer } from "lucide-react";

import { SpendTabs } from "@/components/dashboard/spend-tabs";
import { PortalShell } from "@/components/portal/portal-shell";
import { StatCard } from "@/components/portal/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePortal } from "@/lib/auth/session";
import { listCompanies } from "@/lib/data";
import { isStatementMonth, monthLabel, previousMonth } from "@/lib/finance/monthly-statement";
import { loadMonthlyStatement } from "@/lib/finance/statements";
import { todayInIndia } from "@/lib/gst-engine";
import { cn, formatDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Monthly statements" };

/** The last 12 months, newest first, starting with the current one. */
function recentMonths(today: string): string[] {
  const out = [today.slice(0, 7)];
  while (out.length < 12) out.push(previousMonth(`${out[out.length - 1]}-01`));
  return out;
}

export default async function StatementsPage({ searchParams }: PageProps<"/client/statements">) {
  const member = await requirePortal("/client");
  const { month: monthParam, company: companyParam } = await searchParams;

  const all = await listCompanies();
  const companies = member.role === "ADMIN" ? all : all.filter((c) => c.id === member.companyId);
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  const today = todayInIndia();
  const month = typeof monthParam === "string" && isStatementMonth(monthParam) ? monthParam : previousMonth(today);
  const statement = await loadMonthlyStatement(company.id, month);
  if (!statement) notFound();

  const companyQs = member.role === "ADMIN" ? `&company=${company.id}` : "";
  const fileHref = (format: "csv" | "html") => `/api/finance/statements?month=${month}&format=${format}${companyQs}`;
  const t = statement.totals;

  return (
    <PortalShell
      portal="/client"
      title="Spend"
      actions={
        statement.bookingCount > 0 ? (
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={fileHref("html")} target="_blank" rel="noopener">
                <Printer aria-hidden /> Print
              </a>
            </Button>
            <Button asChild size="sm">
              <a href={fileHref("csv")} download>
                <Download aria-hidden /> CSV
              </a>
            </Button>
          </div>
        ) : null
      }
    >
      <SpendTabs active="/client/statements" query={member.role === "ADMIN" ? `company=${company.id}` : undefined} />
      <nav aria-label="Statement month" className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1">
        {recentMonths(today).map((m) => (
          <Link
            key={m}
            href={`/client/statements?month=${m}${companyQs}`}
            aria-current={m === month ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-fg-muted hover:bg-surface-2",
              m === month && "bg-surface-2 font-medium text-fg",
            )}
          >
            {monthLabel(m)}
          </Link>
        ))}
      </nav>

      {statement.bookingCount === 0 ? (
        <div className="glass grid justify-items-center gap-2 rounded-lg p-10 text-center">
          <FileSpreadsheet className="size-6 text-fg-subtle" aria-hidden />
          <p className="text-body text-fg-muted">No confirmed bookings had events in {statement.label}.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Bookings" value={String(statement.bookingCount)} />
            <StatCard label="Vendors" value={String(statement.vendors.length)} />
            <StatCard label="Total incl. GST" value={formatINR(t.total)} />
            <StatCard label="Balance due" value={formatINR(t.due)} />
          </div>
          <p className="font-mono text-xs text-fg-subtle">
            {statement.number} · Taxable {formatINR(t.taxable, true)} · GST {formatINR(t.tax, true)} · Paid {formatINR(t.paid, true)}
          </p>

          {statement.vendors.map((v) => (
            <Card key={v.venueId}>
              <CardHeader>
                <CardTitle>{v.name}</CardTitle>
                <CardDescription>
                  {[v.city, `GSTIN ${v.gstin}`].filter(Boolean).join(" · ")} · {formatINR(v.total, true)} · due {formatINR(v.due, true)}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor invoice</TableHead>
                      <TableHead>Cost centre</TableHead>
                      <TableHead className="text-right">Guests</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v.lines.map((l) => (
                      <TableRow key={l.bookingId}>
                        <TableCell className="whitespace-nowrap">
                          <Link href={`/client/events/${l.bookingId}`} className="hover:underline">
                            {formatDate(l.eventDate)}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{l.invoiceNumber ?? "Pending"}</TableCell>
                        <TableCell>{l.costCenter ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.partySize}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(l.taxable, true)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(l.cgst + l.sgst + l.igst, true)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(l.total, true)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(l.due, true)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}

          <p className="text-xs text-fg-subtle">
            Not a tax invoice. Each line&apos;s GST is on the vendor&apos;s own tax invoice (number shown), which is what you claim input tax credit against.
          </p>
        </div>
      )}
    </PortalShell>
  );
}
