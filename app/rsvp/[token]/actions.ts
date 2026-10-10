"use server";

import { revalidatePath } from "next/cache";

import { getRsvpInvite, respondToRsvp } from "@/lib/data";
import { rsvpWindow, validateRsvpResponse, type RsvpAnswer } from "@/lib/events/rsvp";
import { todayInIndia } from "@/lib/gst-engine";

export type RsvpFormState = { ok: true; status: RsvpAnswer } | { ok: false; error: string } | null;

/**
 * A guest's reply from their RSVP link. No account: the 256-bit token is the
 * credential, and it only ever changes this one guest's row. The organisers'
 * workspace sees the reply live through Realtime.
 */
export async function respondAction(token: string, _prev: RsvpFormState, form: FormData): Promise<RsvpFormState> {
  const invite = await getRsvpInvite(String(token));
  if (!invite) return { ok: false, error: "This invitation link isn't valid." };
  const window = rsvpWindow({ bookingStatus: invite.booking.status, eventDate: invite.booking.event_date, deadline: invite.workspace.rsvp_deadline, today: todayInIndia() });
  if (!window.open) return { ok: false, error: window.reason };
  const response = validateRsvpResponse({ status: form.get("status"), plusOnes: form.get("plusOnes") ?? 0, dietary: form.get("dietary") });
  if (!response.ok) return { ok: false, error: response.error };
  try {
    await respondToRsvp(invite.attendee.rsvp_token, response.value);
  } catch (err) {
    console.error("rsvp: respond failed", err);
    return { ok: false, error: "Your reply couldn't be saved. Please try again." };
  }
  revalidatePath(`/rsvp/${invite.attendee.rsvp_token}`);
  revalidatePath(`/client/events/${invite.booking.id}`);
  return { ok: true, status: response.value.status };
}
