"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { saveScheduleAction } from "../actions";
import { useRoom } from "./event-room";

/**
 * Event name, times and RSVP deadline. Changing the name or times bumps the
 * invite's SEQUENCE, so calendars that imported it replace their copy.
 * Uncontrolled and keyed by the saved values: a collaborator's save re-renders
 * it with theirs, while a field you're typing in keeps its text until then.
 */
export function ScheduleForm({ bookingId, eventDate, initial, readOnly }: { bookingId: string; eventDate: string; initial: { title: string; startsAt: string; endsAt: string; rsvpDeadline: string }; readOnly: boolean }) {
  const { run, pending } = useAction<{ sequence: number }>();
  const { record } = useRoom();

  async function submit(form: FormData) {
    const outcome = await run(
      () =>
        saveScheduleAction(bookingId, {
          title: String(form.get("title") ?? ""),
          startsAt: String(form.get("startsAt") ?? ""),
          endsAt: String(form.get("endsAt") ?? ""),
          rsvpDeadline: String(form.get("rsvpDeadline") ?? ""),
        }),
      { failure: "Couldn't save the schedule", success: () => ({ tone: "success", title: "Schedule saved" }) }
    );
    if (outcome?.ok) record("schedule", "updated the schedule");
  }

  return (
    <form key={JSON.stringify(initial)} action={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="title">Event name</Label>
        <Input id="title" name="title" maxLength={120} defaultValue={initial.title} placeholder="Q3 offsite dinner" disabled={readOnly} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="startsAt">Starts (IST)</Label>
        <Input id="startsAt" name="startsAt" type="time" required defaultValue={initial.startsAt} disabled={readOnly} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="endsAt">Ends (IST)</Label>
        <Input id="endsAt" name="endsAt" type="time" required defaultValue={initial.endsAt} disabled={readOnly} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rsvpDeadline">RSVP by</Label>
        <Input id="rsvpDeadline" name="rsvpDeadline" type="date" max={eventDate} defaultValue={initial.rsvpDeadline} disabled={readOnly} />
      </div>
      {!readOnly ? (
        <div className="flex items-end justify-end">
          <Button type="submit" disabled={pending} className="min-h-11 sm:min-h-9">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Save schedule
          </Button>
        </div>
      ) : null}
    </form>
  );
}
