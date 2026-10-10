"use server";

import { refresh, revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { addEventAttendees, EventWorkspaceError, getEventRoom, removeEventAttendee, saveEventSchedule, setEventAttendeeStatus } from "@/lib/data";
import { isPlannable, isRsvpStatus, MAX_GUESTS, parseGuestList, validateSchedule, type RsvpStatus } from "@/lib/events/rsvp";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";

/**
 * Event workspace mutations (/client/events/<booking id>). Organizers and
 * Approvers of the booking's company plan; Finance viewers only read. Admins
 * can open any workspace but don't edit a company's guest list.
 * Collaborators' pages update through Realtime (event-room.tsx).
 */

async function planner(bookingId: string) {
  const member = await requirePortal("/client");
  if (member.role !== "CLIENT" || !member.companyId) throw new ActionError("Guest lists are managed by the company's Organizers and Approvers.");
  if (member.corporateRole !== "ORGANIZER" && member.corporateRole !== "APPROVER") throw new ActionError("Finance viewers can see the guest list but not change it.");
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw new ActionError("Booking not found.");
  const room = await getEventRoom(bookingId, member.companyId);
  if (!room) throw new ActionError("Booking not found.");
  if (!isPlannable(room.booking.status)) throw new ActionError("This event can no longer be changed.");
  return { member, companyId: member.companyId, room };
}

function revalidateRoom(bookingId: string) {
  revalidatePath(`/client/events/${bookingId}`);
  revalidatePath("/client");
  refresh();
}

/** Data-layer refusals become messages for the toast. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof EventWorkspaceError) throw new ActionError(err.message);
    throw err;
  }
}

export interface ScheduleForm {
  title: string;
  startsAt: string;
  endsAt: string;
  rsvpDeadline: string;
}

export async function saveScheduleAction(bookingId: string, form: ScheduleForm): Promise<ActionResult<{ sequence: number }>> {
  return serverDispatch("client/events/saveSchedule", async () => {
    const { member, companyId, room } = await planner(bookingId);
    const input = validateSchedule(form ?? {}, room.booking.event_date);
    if (!input.ok) throw new ActionError(input.error);
    const ws = await guarded(() => saveEventSchedule(bookingId, companyId, input.value, member.userId));
    revalidateRoom(bookingId);
    return { sequence: ws.ics_sequence };
  });
}

export interface AddedGuests {
  added: number;
  skipped: number;
  errors: { line: number; error: string }[];
}

/** Adds the pasted guests that parse; reports the lines that didn't. */
export async function addGuestsAction(bookingId: string, text: string): Promise<ActionResult<AddedGuests>> {
  return serverDispatch("client/events/addGuests", async () => {
    const { member, companyId, room } = await planner(bookingId);
    const raw = String(text ?? "");
    if (raw.length > 100_000) throw new ActionError("That list is too long. Paste up to 500 guests at a time.");
    const parsed = parseGuestList(raw, room.attendees.map((a) => a.email));
    if (!parsed.guests.length) {
      if (parsed.errors.length) throw new ActionError(`Line ${parsed.errors[0].line}: ${parsed.errors[0].error}`);
      if (parsed.duplicates) throw new ActionError("Everyone you pasted is already on the guest list.");
      throw new ActionError("Paste at least one guest: a name and an email address.");
    }
    if (room.attendees.length + parsed.guests.length > MAX_GUESTS) throw new ActionError(`A guest list can have up to ${MAX_GUESTS} people.`);
    const result = await guarded(() => addEventAttendees(bookingId, companyId, parsed.guests, member.userId));
    revalidateRoom(bookingId);
    return { added: result.added, skipped: result.skipped + parsed.duplicates, errors: parsed.errors };
  });
}

export async function removeGuestAction(bookingId: string, attendeeId: string): Promise<ActionResult<{ removed: true }>> {
  return serverDispatch("client/events/removeGuest", async () => {
    const { companyId } = await planner(bookingId);
    await guarded(() => removeEventAttendee(String(attendeeId), bookingId, companyId));
    revalidateRoom(bookingId);
    return { removed: true as const };
  });
}

/** Records a reply the guest gave another way (phone, email), or resets it. */
export async function setGuestStatusAction(bookingId: string, attendeeId: string, status: RsvpStatus): Promise<ActionResult<{ status: RsvpStatus }>> {
  return serverDispatch("client/events/setGuestStatus", async () => {
    const { companyId } = await planner(bookingId);
    if (!isRsvpStatus(status)) throw new ActionError("Choose a reply.");
    await guarded(() => setEventAttendeeStatus(String(attendeeId), bookingId, companyId, status));
    revalidateRoom(bookingId);
    return { status };
  });
}
