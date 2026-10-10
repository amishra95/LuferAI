import { getRsvpInvite } from "@/lib/data";
import { buildIcs, icsFilename } from "@/lib/events/ics";
import { eventTitle, inviteEvent } from "@/lib/events/invite";
import { siteUrl } from "@/lib/site-url";

/**
 * A guest's "add to calendar" file (METHOD:PUBLISH). The RSVP token is the
 * credential; the file holds no other guest's details. Same UID as the
 * organiser's invite, so the two never show up as separate events.
 */
export async function GET(req: Request, ctx: RouteContext<"/rsvp/[token]/calendar">) {
  const { token } = await ctx.params;
  const invite = await getRsvpInvite(token);
  if (!invite) return new Response("This invitation link isn't valid.", { status: 404, headers: { "Cache-Control": "no-store" } });

  const url = `${siteUrl(new URL(req.url).origin)}/rsvp/${token}`;
  const src = { booking: invite.booking, workspace: invite.workspace, attendees: [] };
  const ics = buildIcs(inviteEvent(src, { now: new Date(), url }), { withAttendees: false });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8; method=PUBLISH",
      "Content-Disposition": `attachment; filename="${icsFilename(eventTitle(src), invite.booking.event_date)}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
