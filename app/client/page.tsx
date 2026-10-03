import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalShell } from "@/components/portal/portal-shell";
import { BookingStatusBadge, GstTypeBadge } from "@/components/portal/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeItcSummary, listBookings, listCompanies, listVenues } from "@/lib/data";
import { stateName } from "@/lib/gst-engine";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { EventRequestForm } from "./_components/event-request-form";
import { ItcCalculator } from "./_components/itc-calculator";

export default async function ClientPage({ searchParams }: PageProps<"/client">) {
  const { company: companyParam } = await searchParams;
  const companies = await listCompanies();
  // Until sign-in exists, the acting company is chosen via ?company=<id>.
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  const [bookings, venues] = await Promise.all([listBookings({ companyId: company.id }), listVenues()]);
  const itc = computeItcSummary(bookings);

  return (
    <PortalShell
      portal="/client"
      title={company.legal_name}
      subtitle={`GSTIN ${company.gstin} · ${stateName(company.state_code)} · monthly limit ${formatINR(Number(company.monthly_spend_limit_inr))}`}
    >
      {companies.length > 1 ? (
        <div className="-mt-4 mb-6 flex flex-wrap gap-2 text-sm" aria-label="Switch company (demo)">
          <span className="text-muted-foreground">Viewing as:</span>
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/client?company=${c.id}`}
              className={cn(
                "rounded-md border px-2 py-0.5",
                c.id === company.id ? "bg-accent text-accent-foreground border-transparent" : "hover:bg-muted"
              )}
            >
              {c.legal_name.replace(" Private Limited", "")} ({c.state_code})
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Request an event</CardTitle>
            <CardDescription>
              The venue reviews your request; GST is worked out from your GSTIN and the venue&apos;s.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EventRequestForm
              key={company.id}
              companyId={company.id}
              companyGstin={company.gstin}
              venues={venues.map(({ id, name, neighborhood, city, gstin, capacity_max, min_spend_inr, pdr_available }) => ({
                id,
                name,
                neighborhood,
                city,
                gstin,
                capacity_max,
                min_spend_inr: Number(min_spend_inr),
                pdr_available,
              }))}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>GST ITC savings</CardTitle>
            <CardDescription>18% GST on SAC 998596 is claimable as input tax credit.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItcCalculator reclaimed={itc.reclaimed} pipeline={itc.pipeline} committedSpend={itc.committedSpend} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your bookings</CardTitle>
          <CardDescription>{bookings.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event date</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead className="text-right">Guests</TableHead>
                <TableHead>GST</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Invoice total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="tabular-nums">{formatDate(b.event_date)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{b.venue.name}</div>
                    <div className="text-muted-foreground text-xs">{b.venue.neighborhood}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{b.party_size}</TableCell>
                  <TableCell>
                    <GstTypeBadge type={b.invoice.gst_type} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(b.total_amount_inr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(b.invoice.total_tax)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatINR(b.invoice.invoice_total)}</TableCell>
                  <TableCell>
                    <BookingStatusBadge status={b.status} />
                  </TableCell>
                </TableRow>
              ))}
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground py-6 text-center">
                    No bookings yet — send your first request above.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PortalShell>
  );
}
