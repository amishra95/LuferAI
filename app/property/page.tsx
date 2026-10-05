import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, CheckCheck, X } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { StatCard } from "@/components/portal/stat-card";
import { BookingStatusBadge, GstTypeBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeMonthlyPayouts, listBookings, listVenues } from "@/lib/data";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { EventBrief } from "./_components/event-brief";
import { respondToBooking } from "./actions";

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export default async function PropertyPage({ searchParams }: PageProps<"/property">) {
  const { venue: venueParam } = await searchParams;
  const venues = await listVenues();
  // Until sign-in exists, the acting venue is chosen via ?venue=<id>.
  const venue = typeof venueParam === "string" ? venues.find((v) => v.id === venueParam) : venues[0];
  if (!venue) notFound();

  const bookings = await listBookings({ venueId: venue.id });
  const incoming = bookings.filter((b) => b.status === "PENDING");
  const upcoming = bookings.filter((b) => b.status === "CONFIRMED");
  const payouts = computeMonthlyPayouts(bookings);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <PortalShell
      portal="/property"
      title={venue.name}
      subtitle={`${venue.neighborhood}, ${venue.city} · GSTIN ${venue.gstin} · platform commission ${(Number(venue.commission_rate) * 100).toFixed(0)}%`}
    >
      <div className="-mt-4 mb-6 flex flex-wrap gap-2 text-sm" aria-label="Switch venue (demo)">
        <span className="text-muted-foreground">Viewing as:</span>
        {venues.map((v) => (
          <Link
            key={v.id}
            href={`/property?venue=${v.id}`}
            className={cn(
              "rounded-md border px-2 py-0.5",
              v.id === venue.id ? "bg-accent text-accent-foreground border-transparent" : "hover:bg-muted"
            )}
          >
            {v.name}
          </Link>
        ))}
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Summary">
        <StatCard label="Awaiting your response" value={String(incoming.length)} />
        <StatCard label="Confirmed upcoming" value={String(upcoming.length)} />
        <StatCard
          label="Payout pipeline"
          value={formatINR(payouts.reduce((s, p) => s + p.payout, 0))}
          hint="Net of commission, before GST pass-through"
        />
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Incoming requests</CardTitle>
          <CardDescription>Approve to confirm the booking with the client, or decline to release the date.</CardDescription>
        </CardHeader>
        <CardContent>
          {incoming.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">No requests waiting. New ones from clients appear here.</p>
          ) : (
            <ul className="divide-y">
              {incoming.map((b) => (
                <li key={b.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <div className="font-medium">{b.company.legal_name}</div>
                    <div className="text-muted-foreground text-sm">
                      {formatDate(b.event_date)} · {b.party_size} guests · {formatINR(b.budget_per_head_inr)}/head ·{" "}
                      {formatINR(b.total_amount_inr)} taxable
                    </div>
                    {b.notes ? <p className="mt-1 text-sm">“{b.notes}”</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <GstTypeBadge type={b.invoice.gst_type} />
                      <Badge variant="secondary">You receive {formatINR(b.venue_payout_inr)}</Badge>
                    </div>
                  </div>
                  <form action={respondToBooking} className="flex gap-2">
                    <input type="hidden" name="booking_id" value={b.id} />
                    <input type="hidden" name="venue_id" value={venue.id} />
                    <Button type="submit" name="intent" value="approve" size="sm">
                      <Check aria-hidden /> Approve
                    </Button>
                    <Button type="submit" name="intent" value="decline" size="sm" variant="outline">
                      <X aria-hidden /> Decline
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Host view · event briefs</CardTitle>
          <CardDescription>
            AI-drafted briefs for upcoming events: run of show, catering and budget limits from the client&apos;s request.
            Suggestions are marked; confirm them with the client.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {incoming.length + upcoming.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">No upcoming events to brief.</p>
          ) : (
            <ul className="divide-y">
              {[...incoming, ...upcoming].map((b) => (
                <li key={b.id} className="grid gap-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{b.company.legal_name}</span>
                    <span className="text-muted-foreground text-sm">
                      {formatDate(b.event_date)} · {b.party_size} guests
                    </span>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <EventBrief bookingId={b.id} venueId={venue.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly payouts</CardTitle>
            <CardDescription>Confirmed and completed events, by event month.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Payout</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.month}>
                    <TableCell>{monthLabel(p.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.bookings}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(p.taxableValue)}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">−{formatINR(p.commission)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatINR(p.payout)}</TableCell>
                    <TableCell>
                      <Badge variant={p.settled ? "success" : "outline"}>{p.settled ? "Settled" : "Scheduled"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {payouts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                      No payouts yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Booking history</CardTitle>
            <CardDescription>Mark confirmed events complete once they&apos;ve taken place to trigger settlement.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Payout</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="tabular-nums">{formatDate(b.event_date)}</TableCell>
                    <TableCell>{b.company.legal_name.replace(" Private Limited", "")}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(b.venue_payout_inr)}</TableCell>
                    <TableCell>
                      {b.status === "CONFIRMED" && b.event_date <= today ? (
                        <form action={respondToBooking}>
                          <input type="hidden" name="booking_id" value={b.id} />
                          <input type="hidden" name="venue_id" value={venue.id} />
                          <Button type="submit" name="intent" value="complete" size="sm" variant="secondary">
                            <CheckCheck aria-hidden /> Mark completed
                          </Button>
                        </form>
                      ) : (
                        <BookingStatusBadge status={b.status} />
                      )}
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
