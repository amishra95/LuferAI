import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, CalendarArrowDown, ClipboardCheck, IndianRupee, Salad } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { BookingStatusBadge, PaymentStatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePortal } from "@/lib/auth/session";
import { dataSource, findExpenseExport, getEventPlan, getEventRoom, listEventCheckins, listPortalUsers } from "@/lib/data";
import { seedActivity } from "@/lib/events/activity";
import { depositReadiness, invoiceLines, receiptReadiness, type Readiness } from "@/lib/events/finance";
import { checkInBlocker, planStatus } from "@/lib/events/plan";
import { todayInIndia } from "@/lib/gst-engine";
import { latestPayments, paymentsEnabled } from "@/lib/payments/service";
import { listVenuePackages } from "@/lib/rfp/service";
import { eventTitle, venueLine } from "@/lib/events/invite";
import { displayName } from "@/lib/events/presence";
import { isPlannable, isRsvpStatus, summarizeDietary, summarizeRsvps } from "@/lib/events/rsvp";
import { siteUrl } from "@/lib/site-url";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { ActivityTicker, EventRoom, RoomPresence, SectionPresence } from "./_components/event-room";
import { EventPlanEditor, PlanStatusBadge, SignOffButton, SignOffTrail } from "./_components/event-plan";
import { GuestList, type GuestRow } from "./_components/guest-list";
import { ScheduleForm } from "./_components/schedule-form";

const time = (t: string) => t.slice(0, 5);

/**
 * The multiplayer planning workspace for one booking: the event at a glance,
 * the plan (run of show, catering, requirements) with its sign-off, the guest
 * list with RSVPs, dietary needs and check-in, the money (invoice lines,
 * deposit, receipt), the schedule and the calendar invite. Everyone at the
 * company with the page open sees each other and each other's changes live.
 */
export default async function EventWorkspacePage({ params }: PageProps<"/client/events/[id]">) {
  const member = await requirePortal("/client");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Clients see their own company's bookings; admins any (read-only).
  if (member.role !== "ADMIN" && !member.companyId) notFound();
  const room = await getEventRoom(id, member.role === "ADMIN" ? undefined : member.companyId!);
  if (!room) notFound();
  const { booking, workspace, attendees } = room;

  const canPlan = member.role === "CLIENT" && (member.corporateRole === "ORGANIZER" || member.corporateRole === "APPROVER");
  const readOnly = !canPlan || !isPlannable(booking.status);
  const summary = summarizeRsvps(attendees, booking.party_size);
  const h = await headers();
  const origin = siteUrl(`${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`);
  const guests: GuestRow[] = attendees.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    status: isRsvpStatus(a.rsvp_status) ? a.rsvp_status : "INVITED",
    plusOnes: a.plus_ones,
    dietary: a.dietary,
    rsvpUrl: `${origin}/rsvp/${a.rsvp_token}`,
  }));
  const back = member.role === "ADMIN" ? `/client?company=${booking.company_id}` : "/client";
  const live = dataSource() === "supabase";
  const today = todayInIndia();
  const [users, { plan, ready: planReady }, packages, checkins, payments, receiptExport] = await Promise.all([
    listPortalUsers({ companyId: booking.company_id }),
    getEventPlan(booking.id),
    live ? listVenuePackages(booking.venue_id) : Promise.resolve([]),
    listEventCheckins(booking.id),
    latestPayments([booking.id]),
    findExpenseExport(booking.id, "booking.confirmed"),
  ]);
  const people = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const activity = seedActivity({ attendees, workspace, people });

  const role = member.role === "CLIENT" ? member.corporateRole : null;
  const adminReadOnly = member.role === "ADMIN" ? "Platform admins view this event read-only." : undefined;
  const stage = planStatus(plan).stage;
  const payment = payments.get(booking.id) ?? null;
  const lines = invoiceLines(booking);
  const deposit = depositReadiness(booking.status, payment ? { status: payment.status, amount_inr: Number(payment.amount_inr) } : null, paymentsEnabled());
  const receipt = receiptReadiness(booking.status, receiptExport?.status ?? null);
  const dietary = summarizeDietary(attendees);
  const checkInReason = checkInBlocker(booking.status, booking.event_date, today);
  const canCheckIn = canPlan && checkins.ready && checkInReason === null;
  const showCheckIn = checkins.ready && (["CONFIRMED", "COMPLETED", "SETTLED"].includes(booking.status));

  return (
    <PortalShell
      title={eventTitle(room)}
      subtitle={`${formatDate(booking.event_date)} · ${time(workspace.starts_at)}–${time(workspace.ends_at)} IST · ${venueLine(booking.venue)}`}
    >
      <EventRoom bookingId={booking.id} self={{ userId: member.userId, name: displayName(member.email) }} realtime={dataSource() === "supabase"} activity={activity}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={back} className="text-fg-subtle hover:text-fg inline-flex items-center gap-1.5 text-meta">
            <ArrowLeft className="size-3.5" aria-hidden /> All bookings
          </Link>
          <RoomPresence />
        </div>

        <dl aria-label="Event overview" className="panel grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-3 lg:grid-cols-5">
          <Fact label="Date">
            {formatDate(booking.event_date)}
            <span className="text-fg-subtle block text-caption">
              {time(workspace.starts_at)}–{time(workspace.ends_at)} IST
            </span>
          </Fact>
          <Fact label="Venue">
            {booking.venue.name}
            <span className="text-fg-subtle block text-caption">{booking.venue.neighborhood}</span>
          </Fact>
          <Fact label="Guests">
            <span className="tabular-nums">{booking.party_size} booked</span>
            <span className="text-fg-subtle block text-caption tabular-nums">
              {summary.going} going · {attendees.length} invited
            </span>
          </Fact>
          <Fact label="Cost centre">
            <span className="font-mono">{booking.cost_center ?? "—"}</span>
            {booking.project_code ? <span className="text-fg-subtle block font-mono text-caption">{booking.project_code}</span> : null}
          </Fact>
          <Fact label="Status">
            <span className="flex flex-wrap gap-1.5">
              <BookingStatusBadge status={booking.status} audience="client" />
              {planReady ? <PlanStatusBadge plan={plan} /> : null}
            </span>
            {booking.venue_accepted_at ? (
              <span className="text-fg-subtle block text-caption">
                Accepted {new Date(booking.venue_accepted_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}
              </span>
            ) : null}
          </Fact>
        </dl>

        {planReady && (stage === "draft" || stage === "changed") ? (
          <section
            aria-label="Event plan sign-off"
            className={cn("flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border px-5 py-4", stage === "changed" ? "border-warn/40 bg-warn/[0.05]" : "border-line-strong bg-surface-raised")}
          >
            <ClipboardCheck className="text-fg-subtle size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-fg text-body font-medium">{stage === "changed" ? "The event plan changed after sign-off" : "The event plan needs sign-off"}</p>
              <SignOffTrail plan={plan} approverName={plan.approvedBy ? (people[plan.approvedBy] ?? null) : null} />
            </div>
            <SignOffButton bookingId={booking.id} plan={plan} role={role} readOnlyReason={adminReadOnly ?? (isPlannable(booking.status) ? undefined : "This event can no longer be changed.")} />
          </section>
        ) : null}

        {readOnly && canPlan ? (
          <p role="status" className="border-line text-fg-muted rounded-md border px-3 py-2 text-meta">
            This event is {booking.status.toLowerCase()}: the schedule and guest list are read-only.
          </p>
        ) : null}

        <section aria-label="RSVP summary" className={cn("grid grid-cols-2 gap-3", showCheckIn ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
          {[
            { label: "Going", value: summary.going, hint: `${summary.expected} people incl. guests` },
            { label: "Maybe", value: summary.maybe, hint: `up to ${summary.expectedHigh} people` },
            { label: "Not going", value: summary.declined, hint: `${summary.awaiting} yet to reply` },
            { label: "Booked for", value: summary.capacity, hint: summary.overCapacity ? `${summary.expected - summary.capacity} over: ask the venue` : `${Math.round(summary.responseRate * 100)}% replied`, alert: summary.overCapacity },
            ...(showCheckIn ? [{ label: "Attended", value: checkins.attended.size, hint: checkInReason ?? `of ${summary.going} going` }] : []),
          ].map((s) => (
            <div key={s.label} className={cn("border-line rounded-md border px-3 py-2.5", s.alert && "border-rose/40")}>
              <div className="text-fg-subtle text-caption">{s.label}</div>
              <div className="text-section font-semibold tabular-nums">{s.value}</div>
              <div className={cn("text-caption", s.alert ? "text-rose" : "text-fg-faint")}>{s.hint}</div>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid content-start gap-6">
          <Card data-room-section="plan">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                Event plan <SectionPresence section="plan" />
                {planReady ? <PlanStatusBadge plan={plan} /> : null}
              </CardTitle>
              <CardDescription>Run of show, catering and special requirements. An Approver signs it off; the venue then confirms it on their event brief.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {planReady && stage === "approved" ? <SignOffTrail plan={plan} approverName={plan.approvedBy ? (people[plan.approvedBy] ?? null) : null} /> : null}
              <EventPlanEditor bookingId={booking.id} plan={plan} packages={packages} readOnly={readOnly} ready={planReady} />
            </CardContent>
          </Card>

          <Card data-room-section="guests">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                Guest list <SectionPresence section="guests" />
              </CardTitle>
              <CardDescription>Each guest gets a personal RSVP link; no account needed. Replies show up here as they arrive.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {dietary.length ? (
                <div className="border-line flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 text-meta" aria-label="Dietary needs">
                  <Salad className="text-fg-subtle size-4" aria-hidden />
                  <span className="text-fg-subtle">Dietary needs (going or maybe):</span>
                  {dietary.map((d) => (
                    <Badge key={d.need} variant="secondary">
                      {d.need} ×{d.count}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <GuestList
                bookingId={booking.id}
                guests={guests}
                readOnly={readOnly}
                checkIn={{ ready: showCheckIn, canMark: canCheckIn, reason: canPlan ? checkInReason : "Organizers and Approvers check guests in.", attended: Object.fromEntries(checkins.attended) }}
              />
            </CardContent>
          </Card>
          </div>

          <div className="grid content-start gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <IndianRupee className="size-4" aria-hidden /> Cost &amp; invoice
                </CardTitle>
                <CardDescription>From the booking&apos;s tax invoice (SAC 998596). GST is claimable as input tax credit.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <dl className="grid gap-1.5 text-meta">
                  {lines.map((l) => (
                    <div key={l.label} className={cn("flex items-baseline justify-between gap-3", (l.kind === "subtotal" || l.kind === "total") && "border-line border-t pt-1.5")}>
                      <dt className={cn(l.kind === "total" ? "text-fg font-medium" : "text-fg-muted")}>
                        {l.label}
                        {l.detail ? <span className="text-fg-faint block text-caption">{l.detail}</span> : null}
                      </dt>
                      <dd className={cn("font-mono tabular-nums", l.kind === "total" ? "text-fg font-semibold" : l.kind === "discount" ? "text-sage" : "text-fg")}>
                        {l.kind === "discount" ? `−${formatINR(Math.abs(l.amount), true)}` : formatINR(l.amount, true)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <ul className="grid gap-2 text-meta">
                  <ReadinessRow item={deposit} badge={payment ? <PaymentStatusBadge status={payment.status} /> : null} />
                  <ReadinessRow item={receipt} action={receiptExport ? <a href={`/api/exports/${receiptExport.id}`} download className="text-fg hover:underline">Download</a> : null} />
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-4" aria-hidden /> Activity
                </CardTitle>
                <CardDescription>Your team&apos;s edits and guests&apos; replies, live.</CardDescription>
              </CardHeader>
              <CardContent className="max-h-72 overflow-y-auto">
                <ActivityTicker />
              </CardContent>
            </Card>

            <Card data-room-section="schedule">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-3">
                  Schedule <SectionPresence section="schedule" />
                </CardTitle>
                <CardDescription>{formatDate(booking.event_date)} · {booking.party_size} booked</CardDescription>
              </CardHeader>
              <CardContent>
                <ScheduleForm
                  bookingId={booking.id}
                  eventDate={booking.event_date}
                  readOnly={readOnly}
                  initial={{ title: workspace.title ?? "", startsAt: time(workspace.starts_at), endsAt: time(workspace.ends_at), rsvpDeadline: workspace.rsvp_deadline ?? "" }}
                />
              </CardContent>
            </Card>

            <Card data-room-section="invite">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-3">
                  Calendar invite <SectionPresence section="invite" />
                </CardTitle>
                <CardDescription>
                  An .ics with every guest and their reply, to send from Outlook or Google Calendar. Re-export after changes: calendars update the same event
                  {workspace.ics_sequence ? ` (revision ${workspace.ics_sequence})` : ""}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href={`/api/events/${booking.id}/calendar`} download className="btn min-h-11 w-full justify-center sm:min-h-9">
                  <CalendarArrowDown className="size-4" aria-hidden /> {booking.status === "CANCELLED" ? "Download cancellation (.ics)" : "Download invite (.ics)"}
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </EventRoom>
    </PortalShell>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label-mono">{label}</dt>
      <dd className="text-fg mt-1 text-body">{children}</dd>
    </div>
  );
}

const READINESS_DOT: Record<Readiness["tone"], string> = { done: "bg-sage", pending: "bg-warn", waiting: "bg-fg-subtle", none: "bg-fg-faint", problem: "bg-rose" };

function ReadinessRow({ item, badge, action }: { item: Readiness; badge?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5" title={item.hint}>
      <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", READINESS_DOT[item.tone])} />
      <span className="min-w-0 flex-1">
        <span className={cn(item.tone === "problem" ? "text-rose" : "text-fg")}>{item.label}</span>
        <span className="text-fg-subtle block text-caption">{item.hint}</span>
      </span>
      {badge}
      {action}
    </li>
  );
}

