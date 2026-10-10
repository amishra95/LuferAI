/**
 * An event workspace as an iCalendar event (lib/events/ics.ts). Pure: shared
 * by the organiser's export and the guest's download, and tested directly.
 */
import type { IcsEvent } from "./ics.ts";
import { isRsvpStatus, partstatOf } from "./rsvp.ts";

export interface InviteSource {
  booking: { id: string; event_date: string; status: string; party_size: number; company: { legal_name: string }; venue: { name: string; neighborhood: string | null; city: string | null } };
  workspace: { title: string | null; starts_at: string; ends_at: string; ics_sequence: number };
  attendees: { name: string; email: string; rsvp_status: string }[];
}

export const eventTitle = (src: Pick<InviteSource, "booking" | "workspace">) => src.workspace.title ?? `${src.booking.company.legal_name} at ${src.booking.venue.name}`;

export function venueLine(venue: InviteSource["booking"]["venue"]): string {
  return [venue.name, venue.neighborhood, venue.city].filter(Boolean).join(", ");
}

export function inviteEvent(src: InviteSource, opts: { now: Date; url?: string; organizer?: { name: string; email: string } }): IcsEvent {
  return {
    uid: src.booking.id,
    sequence: src.workspace.ics_sequence,
    date: src.booking.event_date,
    start: src.workspace.starts_at.slice(0, 5),
    end: src.workspace.ends_at.slice(0, 5),
    summary: eventTitle(src),
    location: venueLine(src.booking.venue),
    description: [`Hosted by ${src.booking.company.legal_name}.`, opts.url ? `RSVP or update your reply: ${opts.url}` : null].filter(Boolean).join("\n"),
    url: opts.url,
    organizer: opts.organizer,
    attendees: src.attendees.map((a) => ({ name: a.name, email: a.email, partstat: partstatOf(isRsvpStatus(a.rsvp_status) ? a.rsvp_status : "INVITED") })),
    cancelled: src.booking.status === "CANCELLED",
    now: opts.now,
  };
}
