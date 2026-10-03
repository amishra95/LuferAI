import { CalendarCheck, IndianRupee, Landmark, Receipt } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { StatCard } from "@/components/portal/stat-card";
import { BookingStatusBadge, GstTypeBadge, OnboardingStatusBadge } from "@/components/portal/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computePlatformMetrics, listBookings, listOnboardingRequests } from "@/lib/data";
import { stateName } from "@/lib/gst-engine";
import { formatDate, formatINR } from "@/lib/utils";

export default async function AdminPage() {
  const [bookings, onboarding] = await Promise.all([listBookings(), listOnboardingRequests()]);
  const m = computePlatformMetrics(bookings);

  return (
    <PortalShell
      portal="/admin"
      title="Platform overview"
      subtitle="Marketplace health across every company and venue."
    >
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
      </div>
    </PortalShell>
  );
}
