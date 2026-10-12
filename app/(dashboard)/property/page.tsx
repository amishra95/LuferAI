import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CalendarX2, Check, CheckCheck, ClipboardList, Inbox, Lock, Receipt, Unlock, X } from "lucide-react";

import { EmptyState } from "@/components/portal/empty-state";
import { PortalShell } from "@/components/portal/portal-shell";
import { segmentClass } from "@/components/portal/segment";
import { StatCard } from "@/components/portal/stat-card";
import { BookingStatusBadge, GstTypeBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePortal } from "@/lib/auth/session";
import { blockedDatesReady, computeMonthlyPayouts, dataSource, listBlockedDates, listBookings, listEventPlans, listLiveHolds, listVenues } from "@/lib/data";
import { todayInIndia } from "@/lib/gst-engine";
import { dietaryLabel } from "@/lib/quotes";
import { lowestAllowedPerHead, NO_RULES } from "@/lib/rfp/guardrails";
import { getNegotiationRules } from "@/lib/rfp/rules-store";
import { listVenuePackages, listVenueRfps, quoteableCompanies } from "@/lib/rfp/service";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { HoldCountdown } from "@/components/portal/hold-countdown";
import { RateCardPill } from "@/components/portal/pills";
import { activeHolds } from "@/lib/approvals/service";
import { EventBrief } from "./_components/event-brief";
import { BlockDates, DirectQuote, RfpCounterForm } from "./_components/host-forms";
import { NegotiatorDrawer } from "./_components/negotiator-drawer";
import { PlanAck } from "./_components/plan-ack";
import { convertVenueHold, releaseVenueHold, respondToBooking, unblockDateAction } from "./actions";

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

type Tab = "requests" | "briefs" | "payouts";

export default async function PropertyPage({ searchParams }: PageProps<"/property">) {
  const member = await requirePortal("/property");
  const { venue: venueParam, tab: tabParam } = await searchParams;
  const allVenues = await listVenues();
  // Property managers are pinned to their own venue; admins may switch via ?venue=<id>.
  const venues = member.role === "ADMIN" ? allVenues : allVenues.filter((v) => v.id === member.venueId);
  const venue = typeof venueParam === "string" ? venues.find((v) => v.id === venueParam) : venues[0];
  if (!venue) notFound();
  const tab: Tab = tabParam === "briefs" ? "briefs" : tabParam === "payouts" ? "payouts" : "requests";

  const live = dataSource() === "supabase";
  const today = todayInIndia();
  const [bookings, rfpInbox, packages, blocks, blocksReady, guardrails, companies] = await Promise.all([
    listBookings({ venueId: venue.id }),
    live ? listVenueRfps(venue.id) : Promise.resolve([]),
    live ? listVenuePackages(venue.id) : Promise.resolve([]),
    listBlockedDates(venue.id, { from: today, to: "9999-12-31" }),
    blockedDatesReady(),
    live ? getNegotiationRules(venue.id) : Promise.resolve({ rules: NO_RULES, ready: false }),
    live ? quoteableCompanies(venue.id) : Promise.resolve([]),
  ]);
  const incoming = bookings.filter((b) => b.status === "PENDING");
  const [holds, liveHolds] = await Promise.all([activeHolds(incoming.map((b) => b.id)), listLiveHolds(venue.id)]);
  const holdsByDate = [...liveHolds].sort((a, b) => a.event_date.localeCompare(b.event_date));
  const upcoming = bookings.filter((b) => b.status === "CONFIRMED");
  // Clients' signed-off event plans, shown under each brief.
  const plans = await listEventPlans([...incoming, ...upcoming].map((b) => b.id));
  const payouts = computeMonthlyPayouts(bookings);

  const href = (t: Tab) => {
    const q = new URLSearchParams();
    if (member.role === "ADMIN") q.set("venue", venue.id);
    if (t !== "requests") q.set("tab", t);
    return q.size ? `/property?${q}` : "/property";
  };
  const blockDates = (compact = false) => (
    <BlockDates key={`block-${venue.id}`} venueId={venue.id} today={today} compact={compact} disabledReason={blocksReady ? undefined : "Blocking dates needs database migration 0025."} />
  );
  const directQuote = (size: "default" | "sm" = "default") => (
    <DirectQuote
      key={`quote-${venue.id}`}
      venueId={venue.id}
      companies={companies}
      packages={packages.filter((p) => p.is_active)}
      today={today}
      size={size}
      disabledReason={live ? undefined : "Direct quotes need the Supabase data source."}
    />
  );

  return (
    <PortalShell
      portal="/property"
      actions={live ? <NegotiatorDrawer key={venue.id} venueId={venue.id} venueName={venue.name} rules={guardrails.rules} rulesReady={guardrails.ready} /> : null}
      title={venue.name}
      subtitle={`${venue.neighborhood}, ${venue.city} · GSTIN ${venue.gstin} · platform commission ${(Number(venue.commission_rate) * 100).toFixed(0)}% · min spend ${formatINR(Number(venue.min_spend_inr))}`}
    >
      {venues.length > 1 ? (
        <div className="-mt-2 mb-8 flex flex-wrap items-center gap-2" aria-label="Switch venue (admin)">
          <span className="label-mono mr-1">Viewing</span>
          {venues.map((v) => (
            <Link key={v.id} href={`/property?venue=${v.id}`} className={segmentClass(v.id === venue.id)}>
              {v.name}
            </Link>
          ))}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Summary">
        <StatCard label="Awaiting your response" value={String(incoming.length)} />
        <StatCard label="Confirmed upcoming" value={String(upcoming.length)} />
        <StatCard label="Payout pipeline" value={formatINR(payouts.reduce((s, p) => s + p.payout, 0))} hint="Net of commission, before GST pass-through" />
      </section>

      <nav className="border-line mt-8 mb-6 flex gap-1 overflow-x-auto border-b" aria-label="Property workspace sections">
        {(
          [
            { key: "requests", label: "Requests & Holds" },
            { key: "briefs", label: "Event Briefs" },
            { key: "payouts", label: "Payouts & History" },
          ] as const
        ).map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("relative -mb-px inline-flex h-10 shrink-0 items-center gap-2 px-3 text-[13px] transition-colors", tab === t.key ? "text-fg font-medium" : "text-fg-subtle hover:text-fg")}
          >
            {t.label}
            {t.key === "requests" && incoming.length > 0 ? (
              <Badge variant="warning" title={`${incoming.length} request${incoming.length === 1 ? "" : "s"} waiting for you`}>
                {incoming.length}
              </Badge>
            ) : null}
            {t.key === "requests" && holdsByDate.length > 0 ? (
              <Badge variant="secondary" title={`${holdsByDate.length} active date hold${holdsByDate.length === 1 ? "" : "s"}`}>
                <Lock className="size-2.5" aria-hidden /> {holdsByDate.length}
                <span className="sr-only"> on hold</span>
              </Badge>
            ) : null}
            {t.key === "briefs" && incoming.length + upcoming.length > 0 ? <Badge variant="secondary">{incoming.length + upcoming.length}</Badge> : null}
            {tab === t.key && <span aria-hidden className="bg-fg absolute inset-x-2 bottom-0 h-[2px] rounded-full" />}
          </Link>
        ))}
      </nav>

      {tab === "requests" ? (
        incoming.length === 0 && holdsByDate.length === 0 && blocks.length === 0 && rfpInbox.length === 0 ? (
          // Nothing pending anywhere: one card with the two things a host can do, not four empty boxes.
          <EmptyState
            icon={Inbox}
            title="Nothing needs you right now"
            description="New booking requests, date holds and RFPs from clients land here. Meanwhile, block dates you can't host, or quote a client you work with."
            action={
              <>
                {blockDates(true)}
                {directQuote("sm")}
              </>
            }
          />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Incoming requests</CardTitle>
                  <CardDescription>Approve to confirm the booking with the client, or decline to release the date.</CardDescription>
                </CardHeader>
                <CardContent>
                  {incoming.length === 0 ? (
                    <p className="text-fg-subtle flex items-center gap-2 text-[13px]">
                      <Inbox className="text-fg-faint size-4" aria-hidden /> No requests waiting. New ones from clients appear here.
                    </p>
                  ) : (
                    <ul className="divide-line divide-y">
                      {incoming.map((b) => (
                        <li key={b.id} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:gap-5">
                          <div className="flex-1">
                            <div className="font-medium">{b.company.legal_name}</div>
                            <div className="text-fg-subtle text-sm">
                              {formatDate(b.event_date)} · {b.party_size} guests · {formatINR(b.budget_per_head_inr)}/head · {formatINR(b.total_amount_inr)} taxable
                            </div>
                            {b.notes ? <p className="mt-1 text-sm">“{b.notes}”</p> : null}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <GstTypeBadge type={b.invoice.gst_type} />
                              {b.rate_card_id ? <RateCardPill label={`${formatINR(b.budget_per_head_inr)}/head`} /> : null}
                              <Badge variant="secondary">You receive {formatINR(b.venue_payout_inr)}</Badge>
                            </div>
                          </div>
                          {holds.get(b.id) ? <HoldCountdown createdAt={holds.get(b.id)!.holdStart} expiresAt={holds.get(b.id)!.expiresAt} className="sm:w-44" /> : null}
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
                <Card>
                  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <CardTitle>RFP inbox</CardTitle>
                      <CardDescription>
                        Clients got an instant quote from your packages and minimum spend. Counter with your own per-head price, decline, or send a client a quote
                        they didn&apos;t ask for. The client&apos;s rate-card discount and GST apply on top of instant quotes only.
                      </CardDescription>
                    </div>
                    {directQuote()}
                  </CardHeader>
                  <CardContent>
                    {rfpInbox.length === 0 ? (
                      <p className="text-fg-subtle flex items-center gap-2 text-[13px]">
                        <ClipboardList className="text-fg-faint size-4" aria-hidden /> No open RFPs. Multi-venue requests from clients land here.
                      </p>
                    ) : (
                      <ul className="divide-line divide-y">
                        {rfpInbox.map(({ response: r, rfp, requirements, companyName }) => {
                          const standard = packages.find((p) => p.id === r.menu_package_id)?.per_head_inr ?? null;
                          return (
                            <li key={r.id} className="grid gap-3 py-4 first:pt-0">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">{companyName.replace(" Private Limited", "")}</span>
                                  {rfp.origin === "venue" ? <Badge variant="outline">Your direct quote</Badge> : null}
                                  <Badge variant={r.status === "countered" ? "default" : r.status === "quoted" ? "secondary" : "outline"}>
                                    {{ quoted: "Instant quote sent", countered: rfp.origin === "venue" ? "Sent" : "Countered", declined: "Declined", no_fit: "Not a fit" }[r.status]}
                                  </Badge>
                                </div>
                                <p className="text-fg-subtle text-sm">
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
                              {rfp.origin === "venue" ? null : (
                                <RfpCounterForm
                                  venueId={venue.id}
                                  responseId={r.id}
                                  currentPerHead={r.per_head_inr != null ? Number(r.per_head_inr) : null}
                                  currentPackageId={r.menu_package_id}
                                  packages={packages}
                                  lowestAllowed={lowestAllowedPerHead(guardrails.rules, standard, rfp.party_size)}
                                />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Inventory holds</CardTitle>
                <CardDescription>
                  Dates held for pending requests release automatically when their timer runs out; convert to confirm, or release now. Blocked dates are ones you
                  marked unavailable: clients can&apos;t request them.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                {blockDates()}
                {holdsByDate.length === 0 && blocks.length === 0 ? (
                  <p className="text-fg-subtle flex items-center gap-2 text-[13px]">
                    <CalendarClock className="text-fg-faint size-4" aria-hidden /> No dates on hold or blocked.
                  </p>
                ) : null}
                {holdsByDate.length > 0 ? (
                  <ul className="divide-line divide-y" aria-label="Held dates">
                    {holdsByDate.map((h) => {
                      // Bookings still awaiting the client's internal sign-off aren't visible to venues.
                      const booking = bookings.find((b) => b.id === h.booking_id);
                      return (
                        <li key={h.id} className="grid gap-3 py-4 first:pt-0">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-fg inline-flex items-center gap-1.5 text-sm tabular-nums">
                              <Lock className="text-fg-faint size-3.5" aria-hidden />
                              {formatDate(h.event_date)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {booking ? (
                                <>
                                  <span className="text-fg font-medium">{booking.company.legal_name.replace(" Private Limited", "")}</span>
                                  <span className="text-fg-subtle">
                                    {" "}
                                    · {booking.party_size} guests · {formatINR(booking.total_amount_inr)}
                                  </span>
                                </>
                              ) : (
                                <span className="text-fg-subtle">Awaiting the client&apos;s internal sign-off</span>
                              )}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <HoldCountdown createdAt={h.hold_start} expiresAt={h.hold_expires_at} className="min-w-40 flex-1" />
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
                ) : null}
                {blocks.length > 0 ? (
                  <section aria-label="Blocked dates">
                    <h3 className="label-mono mb-2">Blocked · {blocks.length}</h3>
                    <ul className="divide-line divide-y">
                      {blocks.map((b) => (
                        <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
                          <CalendarX2 className="text-fg-faint size-3.5 shrink-0" aria-hidden />
                          <span className="text-fg tabular-nums">{formatDate(b.blocked_date)}</span>
                          <span className="text-fg-subtle min-w-0 flex-1 truncate">{b.reason ?? "Unavailable"}</span>
                          <form action={unblockDateAction}>
                            <input type="hidden" name="block_id" value={b.id} />
                            <input type="hidden" name="venue_id" value={venue.id} />
                            <Button type="submit" size="sm" variant="ghost">
                              Unblock
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </CardContent>
            </Card>
          </div>
        )
      ) : tab === "briefs" ? (
        incoming.length + upcoming.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No upcoming events to brief"
            description="Briefs are drafted for requests you're considering and confirmed events: run of show, catering and the client's budget limits."
            action={
              <Link href={href("requests")} className="btn h-8 px-3 text-[12.5px]">
                Go to Requests &amp; Holds
              </Link>
            }
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Event briefs</CardTitle>
              <CardDescription>
                AI-drafted briefs for upcoming events: run of show, catering and budget limits from the client&apos;s request. Suggestions are marked; confirm them
                with the client.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-line divide-y">
                {[...incoming, ...upcoming].map((b) => (
                  <li key={b.id} className="grid gap-3 py-4 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-fg font-medium">{b.company.legal_name}</span>
                      <span className="text-fg-subtle text-sm">
                        {formatDate(b.event_date)} · {b.party_size} guests
                      </span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    {plans.has(b.id) ? (
                      <PlanAck
                        plan={plans.get(b.id)!}
                        bookingId={b.id}
                        venueId={venue.id}
                        cateringPackage={packages.find((p) => p.id === plans.get(b.id)!.cateringPackageId) ?? null}
                      />
                    ) : null}
                    <EventBrief bookingId={b.id} venueId={venue.id} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No payouts or bookings yet"
          description="Confirmed and completed events show here by month, with commission and your payout, alongside the full booking history."
          action={
            <Link href={href("requests")} className="btn h-8 px-3 text-[12.5px]">
              Go to Requests &amp; Holds
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 2xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Monthly payouts</CardTitle>
              <CardDescription>Confirmed and completed events, by event month.</CardDescription>
            </CardHeader>
            <CardContent>
              {payouts.length === 0 ? (
                <p className="text-fg-subtle text-[13px]">No payouts yet: they start once an event is confirmed.</p>
              ) : (
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
                        <TableCell className="text-fg-subtle text-right tabular-nums">−{formatINR(p.commission)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatINR(p.payout)}</TableCell>
                        <TableCell>
                          <Badge variant={p.settled ? "success" : "outline"}>{p.settled ? "Settled" : "Scheduled"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
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
      )}
    </PortalShell>
  );
}
