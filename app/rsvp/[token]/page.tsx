import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarPlus, Clock, MapPin } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRsvpInvite } from "@/lib/data";
import { eventTitle, venueLine } from "@/lib/events/invite";
import { isRsvpStatus, RSVP_LABEL, rsvpWindow } from "@/lib/events/rsvp";
import { todayInIndia } from "@/lib/gst-engine";
import { formatDate } from "@/lib/utils";
import { RsvpForm } from "./_components/rsvp-form";

// The token in the URL is a credential: keep it out of Referer headers and search engines.
export const metadata: Metadata = { title: "RSVP", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const time = (t: string) => t.slice(0, 5);

/** A guest's invitation: event details, their reply, and an "add to calendar" file. No sign-in. */
export default async function RsvpPage({ params }: PageProps<"/rsvp/[token]">) {
  const { token } = await params;
  const invite = await getRsvpInvite(token);
  if (!invite) notFound();
  const { attendee, booking, workspace } = invite;
  const window = rsvpWindow({ bookingStatus: booking.status, eventDate: booking.event_date, deadline: workspace.rsvp_deadline, today: todayInIndia() });
  const status = isRsvpStatus(attendee.rsvp_status) ? attendee.rsvp_status : "INVITED";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 pt-[calc(3rem+var(--app-safe-top))] pb-[calc(3rem+var(--app-safe-bottom))]">
      <Card>
        <CardHeader>
          <p className="text-fg-subtle text-[12px] tracking-wide uppercase">{booking.company.legal_name} invites you</p>
          <CardTitle className="text-lg">{eventTitle(invite)}</CardTitle>
          <CardDescription>Hi {attendee.name.split(" ")[0]}, let the hosts know if you can make it.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <dl className="grid gap-2 text-sm">
            <div className="flex items-start gap-2">
              <Clock className="text-fg-subtle mt-0.5 size-4 shrink-0" aria-hidden />
              <dt className="sr-only">When</dt>
              <dd>
                {formatDate(booking.event_date)} · {time(workspace.starts_at)}–{time(workspace.ends_at)} IST
              </dd>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="text-fg-subtle mt-0.5 size-4 shrink-0" aria-hidden />
              <dt className="sr-only">Where</dt>
              <dd>{venueLine(booking.venue)}</dd>
            </div>
          </dl>

          {window.open ? (
            <RsvpForm token={token} status={status} plusOnes={attendee.plus_ones} dietary={attendee.dietary ?? ""} deadline={workspace.rsvp_deadline} />
          ) : (
            <p role="status" className="border-line text-fg-muted rounded-md border px-3 py-2 text-sm">
              {window.reason}
              {status !== "INVITED" ? ` Your reply: ${RSVP_LABEL[status].toLowerCase()}.` : ""}
            </p>
          )}

          {booking.status !== "CANCELLED" ? (
            <a href={`/rsvp/${token}/calendar`} download className="btn btn-ghost justify-self-start text-[13px]">
              <CalendarPlus className="size-4" aria-hidden /> Add to calendar (.ics)
            </a>
          ) : null}
        </CardContent>
      </Card>
      <p className="text-fg-faint text-center text-[12px]">This link is personal to {attendee.email}. Don&apos;t forward it.</p>
    </main>
  );
}
