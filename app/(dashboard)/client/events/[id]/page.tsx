import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarArrowDown } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { BookingStatusBadge } from "@/components/portal/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePortal } from "@/lib/auth/session";
import { dataSource, getEventRoom } from "@/lib/data";
import { eventTitle, venueLine } from "@/lib/events/invite";
import { displayName } from "@/lib/events/presence";
import { isPlannable, isRsvpStatus, summarizeRsvps } from "@/lib/events/rsvp";
import { siteUrl } from "@/lib/site-url";
import { cn, formatDate } from "@/lib/utils";
import { EventRoom, RoomPresence, SectionPresence } from "./_components/event-room";
import { GuestList, type GuestRow } from "./_components/guest-list";
import { ScheduleForm } from "./_components/schedule-form";

const time = (t: string) => t.slice(0, 5);

/**
 * The multiplayer planning workspace for one booking: schedule, guest list
 * with RSVPs, and the calendar invite. Everyone at the company with the page
 * open sees each other (presence and cursors) and each other's changes live.
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

  return (
    <PortalShell
      title={eventTitle(room)}
      subtitle={`${formatDate(booking.event_date)} · ${time(workspace.starts_at)}–${time(workspace.ends_at)} IST · ${venueLine(booking.venue)}`}
    >
      <EventRoom bookingId={booking.id} self={{ userId: member.userId, name: displayName(member.email) }} realtime={dataSource() === "supabase"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={back} className="text-fg-subtle hover:text-fg inline-flex items-center gap-1.5 text-[13px]">
            <ArrowLeft className="size-3.5" aria-hidden /> Bookings
          </Link>
          <div className="flex items-center gap-3">
            <BookingStatusBadge status={booking.status} />
            <RoomPresence />
          </div>
        </div>

        {readOnly && canPlan ? (
          <p role="status" className="border-line text-fg-muted rounded-md border px-3 py-2 text-[13px]">
            This event is {booking.status.toLowerCase()}: the schedule and guest list are read-only.
          </p>
        ) : null}

        <section aria-label="RSVP summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Going", value: summary.going, hint: `${summary.expected} people incl. guests` },
            { label: "Maybe", value: summary.maybe, hint: `up to ${summary.expectedHigh} people` },
            { label: "Not going", value: summary.declined, hint: `${summary.awaiting} yet to reply` },
            { label: "Booked for", value: summary.capacity, hint: summary.overCapacity ? `${summary.expected - summary.capacity} over: ask the venue` : `${Math.round(summary.responseRate * 100)}% replied`, alert: summary.overCapacity },
          ].map((s) => (
            <div key={s.label} className={cn("border-line rounded-md border px-3 py-2.5", s.alert && "border-rose/40")}>
              <div className="text-fg-subtle text-[12px]">{s.label}</div>
              <div className="text-xl font-semibold tabular-nums">{s.value}</div>
              <div className={cn("text-[12px]", s.alert ? "text-rose" : "text-fg-faint")}>{s.hint}</div>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card data-room-section="guests">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                Guest list <SectionPresence section="guests" />
              </CardTitle>
              <CardDescription>Each guest gets a personal RSVP link; no account needed. Replies show up here as they arrive.</CardDescription>
            </CardHeader>
            <CardContent>
              <GuestList bookingId={booking.id} guests={guests} readOnly={readOnly} />
            </CardContent>
          </Card>

          <div className="grid content-start gap-6">
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
