import { getCurrentMember } from "@/lib/auth/session";
import { getEventRoom } from "@/lib/data";
import { buildIcs, icsFilename } from "@/lib/events/ics";
import { eventTitle, inviteEvent } from "@/lib/events/invite";
import { displayName } from "@/lib/events/presence";

/**
 * The organiser's calendar invite: METHOD:REQUEST with every guest and their
 * reply, for importing into Outlook or Google Calendar to send (METHOD:CANCEL
 * once the booking is cancelled). Guest emails are personal data: the
 * booking's company and admins only.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/events/[id]/calendar">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "Sign in to export invites." }, { status: 401 });
  const { id } = await ctx.params;
  const scope = member.role === "ADMIN" ? undefined : member.role === "CLIENT" && member.companyId ? member.companyId : null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || scope === null) return Response.json({ error: "Not found." }, { status: 404 });
  const room = await getEventRoom(id, scope);
  if (!room) return Response.json({ error: "Not found." }, { status: 404 });

  const organizer = member.email ? { name: `${displayName(member.email)} (${room.booking.company.legal_name})`, email: member.email } : undefined;
  const ics = buildIcs(inviteEvent(room, { now: new Date(), organizer }), { withAttendees: true });
  return new Response(ics, {
    headers: {
      "Content-Type": `text/calendar; charset=utf-8; method=${/^METHOD:(\w+)/m.exec(ics)?.[1] ?? "PUBLISH"}`,
      "Content-Disposition": `attachment; filename="${icsFilename(eventTitle(room), room.booking.event_date)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
