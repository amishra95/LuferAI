import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, CheckCheck, Lock, Unlock, X } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { StatCard } from "@/components/portal/stat-card";
import { BookingStatusBadge, GstTypeBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePortal } from "@/lib/auth/session";
import { computeMonthlyPayouts, dataSource, listBookings, listLiveHolds, listVenues } from "@/lib/data";
import { dietaryLabel } from "@/lib/quotes";
import { listVenuePackages, listVenueRfps } from "@/lib/rfp/service";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { HoldCountdown } from "@/components/portal/hold-countdown";
import { RateCardPill } from "@/components/portal/pills";
import { activeHolds } from "@/lib/approvals/service";
import { EventBrief } from "./_components/event-brief";
import { NegotiatorDrawer } from "./_components/negotiator-drawer";
import { convertVenueHold, releaseVenueHold, respondToBooking, respondToRfpAction } from "./actions";

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export default async function PropertyPage({ searchParams }: PageProps<"/property">) {
  const member = await requirePortal("/property");
  const { venue: venueParam } = await searchParams;
  const allVenues = await listVenues();
  // Property managers are pinned to their own venue; admins may switch via ?venue=<id>.
  const venues = member.role === "ADMIN" ? allVenues : allVenues.filter((v) => v.id === member.venueId);
  const venue = typeof venueParam === "string" ? venues.find((v) => v.id === venueParam) : venues[0];
  if (!venue) notFound();

  const live = dataSource() === "supabase";
  const [bookings, rfpInbox, packages] = await Promise.all([
    listBookings({ venueId: venue.id }),
    live ? listVenueRfps(venue.id) : Promise.resolve([]),
    live ? listVenuePackages(venue.id) : Promise.resolve([]),
  ]);
  const incoming = bookings.filter((b) => b.status === "PENDING");
  const [holds, liveHolds] = await Promise.all([activeHolds(incoming.map((b) => b.id)), listLiveHolds(venue.id)]);
  const holdsByDate = [...liveHolds].sort((a, b) => a.event_date.localeCompare(b.event_date));
  const upcoming = bookings.filter((b) => b.status === "CONFIRMED");
  const payouts = computeMonthlyPayouts(bookings);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <PortalShell
      portal="/property"
      actions={live ? <NegotiatorDrawer key={venue.id} venueId={venue.id} venueName={venue.name} /> : null}
      title={venue.name}
      subtitle={`${venue.neighborhood}, ${venue.city} · GSTIN ${venue.gstin} · platform commission ${(Number(venue.commission_rate) * 100).toFixed(0)}% · min spend ${formatINR(Number(venue.min_spend_inr))}`}
    >
      {venues.length > 1 ? (
        <div className="-mt-3 mb-6 flex gap-2 overflow-x-auto pb-1 text-sm [scrollbar-width:none]" aria-label="Switch venue (admin)">
          {venues.map((v) => (
            <Link
              key={v.id}
              href={`/property?venue=${v.id}`}
              aria-current={v.id === venue.id ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 pointer-coarse:min-h-11",
                v.id === venue.id ? "border-zinc-500 bg-zinc-800 text-zinc-50" : "border-zinc-800/60 text-zinc-400 hover:text-zinc-100"
              )}
            >
              {v.name}
            </Link>
          ))}
        </div>
      ) : null}

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
          <CardTitle>Inventory holds</CardTitle>
          <CardDescription>
            Dates locked for pending requests. A hold releases automatically when its timer runs out; confirm to convert it
            into a booking, or release the date now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {holdsByDate.length === 0 ? (
            <p className="py-4 text-sm text-zinc-400">No dates on hold.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {holdsByDate.map((h) => {
                // Bookings still awaiting the client's internal sign-off aren't visible to venues.
                const booking = bookings.find((b) => b.id === h.booking_id);
                return (
                  <li key={h.id} className="grid gap-3 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_11rem_auto] sm:items-center">
                    <span className="inline-flex items-center gap-1.5 text-sm text-zinc-200 tabular-nums">
                      <Lock className="size-3.5 text-zinc-500" aria-hidden />
                      {formatDate(h.event_date)}
                    </span>
                    <div className="min-w-0">
                      {booking ? (
                        <>
                          <div className="truncate font-medium text-zinc-50">{booking.company.legal_name.replace(" Private Limited", "")}</div>
                          <div className="text-xs text-zinc-400">
                            {booking.party_size} guests · {formatINR(booking.total_amount_inr)} taxable
                          </div>
                        </>
                      ) : (
                        <span className="text-sm text-zinc-400">Awaiting the client&apos;s internal sign-off</span>
                      )}
                    </div>
                    <HoldCountdown createdAt={h.hold_start} expiresAt={h.hold_expires_at} />
                    <div className="flex gap-2 sm:justify-end">
                      {booking?.status === "PENDING" ? (
                        <form action={convertVenueHold}>
                          <input type="hidden" name="booking_id" value={booking.id} />
                          <input type="hidden" name="venue_id" value={venue.id} />
                          <Button type="submit" size="sm">
                            <Check aria-hidden /> Convert
                          </Button>
                        </form>
                      ) : null}
                      <form action={releaseVenueHold}>
                        <input type="hidden" name="hold_id" value={h.id} />
                        <input type="hidden" name="venue_id" value={venue.id} />
                        <Button type="submit" size="sm" variant="outline">
                          <Unlock aria-hidden /> Release
                        </Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

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
                <li key={b.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-5">
                  <div className="flex-1">
                    <div className="font-medium">{b.company.legal_name}</div>
                    <div className="text-muted-foreground text-sm">
                      {formatDate(b.event_date)} · {b.party_size} guests · {formatINR(b.budget_per_head_inr)}/head ·{" "}
                      {formatINR(b.total_amount_inr)} taxable
                    </div>
                    {b.notes ? <p className="mt-1 text-sm">“{b.notes}”</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <GstTypeBadge type={b.invoice.gst_type} />
                      {b.rate_card_id ? <RateCardPill label={`${formatINR(b.budget_per_head_inr)}/head`} /> : null}
                      <Badge variant="secondary">You receive {formatINR(b.venue_payout_inr)}</Badge>
                    </div>
                  </div>
                  {holds.get(b.id) ? (
                    <HoldCountdown createdAt={holds.get(b.id)!.holdStart} expiresAt={holds.get(b.id)!.expiresAt} className="sm:w-44" />
                  ) : null}
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

      {live ? (
        <div className="mt-6 grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>RFP inbox</CardTitle>
              <CardDescription>
                Clients received an instant quote from your packages and minimum spend. Counter with your own per-head
                price, or decline. The client&apos;s rate-card discount and GST are applied on top.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rfpInbox.length === 0 ? (
                <p className="text-muted-foreground py-4 text-sm">No open RFPs. Multi-venue requests from clients land here.</p>
              ) : (
                <ul className="divide-y">
                  {rfpInbox.map(({ response: r, rfp, requirements, companyName }) => (
                    <li key={r.id} className="grid gap-3 py-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{companyName.replace(" Private Limited", "")}</span>
                          <Badge variant={r.status === "countered" ? "default" : r.status === "quoted" ? "secondary" : "outline"}>
                            {{ quoted: "Instant quote sent", countered: "Countered", declined: "Declined", no_fit: "Not a fit" }[r.status]}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {requirements?.summary ?? rfp.brief} · {rfp.party_size} guests
                          {rfp.event_date ? ` · ${formatDate(rfp.event_date)}` : ""}
                          {rfp.budget_per_head_inr != null ? ` · budget ${formatINR(Number(rfp.budget_per_head_inr))}/head` : ""}
                          {rfp.dietary_tags.length ? ` · ${rfp.dietary_tags.map(dietaryLabel).join(", ")}` : ""}
                        </p>
                        {r.per_head_inr != null ? (
                          <p className="mt-1 text-sm">
                            Current offer {formatINR(Number(r.per_head_inr))}/head · {formatINR(Number(r.list_amount_inr))} before discount
                            {r.notes ? ` · ${r.notes}` : ""}
                          </p>
                        ) : r.notes ? (
                          <p className="mt-1 text-sm">{r.notes}</p>
                        ) : null}
                      </div>
                      <form action={respondToRfpAction} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                        <input type="hidden" name="response_id" value={r.id} />
                        <input type="hidden" name="venue_id" value={venue.id} />
                        <Input
                          name="per_head_inr"
                          type="number"
                          min={1}
                          step="any"
                          placeholder="₹ / head"
                          aria-label="Per-head price"
                          defaultValue={r.per_head_inr != null ? Number(r.per_head_inr) : undefined}
                        />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <NativeSelect name="menu_package_id" aria-label="Menu package" defaultValue={r.menu_package_id ?? ""}>
                            <option value="">No package</option>
                            {packages.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} — {formatINR(p.per_head_inr)}
                                {p.is_active ? "" : " (inactive)"}
                              </option>
                            ))}
                          </NativeSelect>
                          <Input name="notes" placeholder="Note to client (optional)" aria-label="Note to client" maxLength={280} />
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" name="intent" value="counter" size="sm">
                            Counter
                          </Button>
                          <Button type="submit" name="intent" value="decline" size="sm" variant="outline" formNoValidate>
                            Decline
                          </Button>
                        </div>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

        </div>
      ) : null}

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
            <p className="py-4 text-sm text-zinc-400">No upcoming events to brief.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {[...incoming, ...upcoming].map((b) => (
                <li key={b.id} className="grid gap-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-50">{b.company.legal_name}</span>
                    <span className="text-sm text-zinc-400">
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
