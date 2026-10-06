import Link from "next/link";
import { CalendarCheck, IndianRupee, Landmark, Receipt } from "lucide-react";

import { CumulativeSpendChart, DepartmentBudgetChart, SavingsChart } from "@/components/admin/spend-charts";
import { getSpendAnalytics } from "@/lib/data/analytics";

import { PortalShell } from "@/components/portal/portal-shell";
import { StatCard } from "@/components/portal/stat-card";
import {
  ApprovalStatusBadge,
  BookingStatusBadge,
  GstTypeBadge,
  OnboardingStatusBadge,
} from "@/components/portal/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePortal } from "@/lib/auth/session";
import { computePlatformMetrics, listApprovals, listBookings, listCompanies, listOnboardingRequests } from "@/lib/data";
import { stateName } from "@/lib/gst-engine";
import { cn, formatDate, formatINR } from "@/lib/utils";

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  await requirePortal("/admin");
  const { tenant } = await searchParams;
  const tenantId = typeof tenant === "string" ? tenant : undefined;
  const [bookings, onboarding, companies, approvals] = await Promise.all([
    listBookings(),
    listOnboardingRequests(),
    listCompanies(),
    listApprovals({ tenantId }),
  ]);
  const shortName = (name: string) => name.replace(" Private Limited", "");
  const m = computePlatformMetrics(bookings);
  const a = await getSpendAnalytics(bookings);

  return (
    <PortalShell
      portal="/admin"
      title="Platform overview"
      subtitle="Marketplace health across every company and venue."
    >
      <section aria-labelledby="exec-heading" className="mb-10 grid gap-4">
        <h2 id="exec-heading" className="sr-only">
          Executive spend analytics
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardDescription>Corporate spend · {a.fyLabel} to date (pre-GST)</CardDescription>
              <CardTitle className="text-4xl font-semibold tracking-tight tabular-nums">{formatINR(a.fytdSpend)}</CardTitle>
              <p className="text-xs text-zinc-400">
                {formatINR(a.committedAhead)} more committed for later this year · {a.pendingApprovals} awaiting corporate approval
              </p>
            </CardHeader>
            <CardContent>
              <CumulativeSpendChart months={a.months} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Rate-card savings · {a.fyLabel} to date</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">{formatINR(a.fytdSavings)}</CardTitle>
            </CardHeader>
            <CardContent>
              <SavingsChart months={a.months} />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Department budget usage</CardTitle>
            <CardDescription>Committed spend against each department&apos;s {a.fyLabel} budget</CardDescription>
          </CardHeader>
          <CardContent>
            <DepartmentBudgetChart departments={a.departments} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key metrics">
        <StatCard label="Total bookings" value={String(m.totalBookings)} hint={`${m.pendingBookings} awaiting venue approval`} icon={CalendarCheck} />
        <StatCard label="Gross booking value" value={formatINR(m.grossBookingValue)} hint="Pre-GST, excludes cancelled" icon={IndianRupee} />
        <StatCard label="Commission earned" value={formatINR(m.commissionEarned)} hint="Confirmed + completed bookings" icon={Landmark} />
        <StatCard label="GST invoiced" value={formatINR(m.gstCollected)} hint="SAC 998596, all live bookings" icon={Receipt} />
      </section>

      <div className="mt-8 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Venue onboarding requests</CardTitle>
            <CardDescription>{onboarding.length} active in the queue</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venue</TableHead>
                  <TableHead>GST state</TableHead>
                  <TableHead className="text-right">Take rate</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {onboarding.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.venue_name}</div>
                      <div className="text-muted-foreground text-xs">
                        {r.neighborhood}, {r.city} · {r.capacity_max ?? "—"} pax{r.pdr_available ? " · PDR" : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{stateName(r.gstin.slice(0, 2))}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(Number(r.proposed_commission_rate) * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell>
                      <OnboardingStatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
                {onboarding.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                      No pending onboarding requests.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>All bookings</CardTitle>
            <CardDescription>Tax treatment is derived from company vs venue GSTIN state codes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Company → Venue</TableHead>
                  <TableHead>GST</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="tabular-nums">{formatDate(b.event_date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{b.company.legal_name.replace(" Private Limited", "")}</div>
                      <div className="text-muted-foreground text-xs">
                        {b.venue.name} · {b.party_size} pax
                      </div>
                    </TableCell>
                    <TableCell>
                      <GstTypeBadge type={b.invoice.gst_type} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(b.total_amount_inr)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(b.commission_inr)}</TableCell>
                    <TableCell>
                      <BookingStatusBadge status={b.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card id="approvals">
          <CardHeader>
            <CardTitle>Approval audit</CardTitle>
            <CardDescription>
              Every policy sign-off request across the platform, newest first · {approvals.length} shown
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Filter by tenant">
              <span className="text-muted-foreground">Tenant:</span>
              {[{ id: undefined, legal_name: "All" }, ...companies].map((c) => (
                <Link
                  key={c.id ?? "all"}
                  href={c.id ? `/admin?tenant=${c.id}#approvals` : "/admin#approvals"}
                  aria-current={c.id === tenantId ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-9 items-center rounded-full border px-3 pointer-coarse:min-h-11",
                    c.id === tenantId ? "border-zinc-500 bg-zinc-800 text-zinc-50" : "border-zinc-800/60 text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  {shortName(c.legal_name)}
                </Link>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead>Tenant · Booking</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead>Requested by → Approver</TableHead>
                  <TableHead>Reason · Decision note</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Decided</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="tabular-nums">{formatDate(a.created_at.slice(0, 10))}</TableCell>
                    <TableCell>
                      <div className="font-medium">{shortName(a.company.legal_name)}</div>
                      <div className="text-muted-foreground text-xs">
                        {a.booking.venue_name} · {formatDate(a.booking.event_date)} · {a.booking.party_size} pax
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(a.booking.total_amount_inr)}</TableCell>
                    <TableCell className="text-sm">
                      {a.requester_name}
                      <span className="text-muted-foreground"> → </span>
                      {a.approver_name}
                    </TableCell>
                    <TableCell className="max-w-xs text-sm whitespace-normal">
                      {a.reason ?? "—"}
                      {a.decision_note ? <div className="text-muted-foreground mt-1 text-xs">“{a.decision_note}”</div> : null}
                    </TableCell>
                    <TableCell>
                      <ApprovalStatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{a.decided_at ? formatDate(a.decided_at.slice(0, 10)) : "—"}</TableCell>
                  </TableRow>
                ))}
                {approvals.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground py-6 text-center">
                      No approval requests{tenantId ? " for this tenant" : ""} yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}
