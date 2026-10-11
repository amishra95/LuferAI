"use client";

import { useRef } from "react";
import { CheckCheck, Loader2, Trash2, UserPlus, Users } from "lucide-react";

import { CopyButton } from "@/components/portal/copy-button";
import { EmptyState } from "@/components/portal/empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction, useOptimisticMutation } from "@/components/workspace/use-optimistic-mutation";
import { RSVP_LABEL, RSVP_STATUSES, type RsvpStatus } from "@/lib/events/rsvp";
import { cn } from "@/lib/utils";
import { addGuestsAction, removeGuestAction, setAttendanceAction, setGuestStatusAction, type AddedGuests } from "../actions";
import { useRoom } from "./event-room";

export interface GuestRow {
  id: string;
  name: string;
  email: string;
  status: RsvpStatus;
  plusOnes: number;
  dietary: string | null;
  rsvpUrl: string;
}

const STATUS_TONE: Record<RsvpStatus, string> = {
  INVITED: "text-fg-subtle",
  ACCEPTED: "text-sage",
  TENTATIVE: "text-warn",
  DECLINED: "text-rose",
};

/** Check-in: whether the column shows (ready), whether it can change now, and why not. */
export interface CheckIn {
  ready: boolean;
  canMark: boolean;
  reason: string | null;
  /** attendee id → checked-in time. */
  attended: Record<string, string>;
}

/** Paste-to-add, then one row per guest with their reply, check-in and personal RSVP link. */
export function GuestList({ bookingId, guests, readOnly, checkIn }: { bookingId: string; guests: GuestRow[]; readOnly: boolean; checkIn?: CheckIn }) {
  const { value: rows, mutate } = useOptimisticMutation(guests);
  const { value: attended, mutate: mutateAttended } = useOptimisticMutation(checkIn?.attended ?? {});
  const add = useAction<AddedGuests>();
  const { record } = useRoom();
  const paste = useRef<HTMLTextAreaElement>(null);

  async function addGuests() {
    const text = paste.current?.value ?? "";
    const outcome = await add.run(() => addGuestsAction(bookingId, text), {
      failure: "Couldn't add guests",
      success: (r) => ({
        tone: r.errors.length ? "info" : "success",
        title: `Added ${r.added} guest${r.added === 1 ? "" : "s"}`,
        description: [r.skipped ? `${r.skipped} already on the list.` : "", r.errors.length ? `Skipped line ${r.errors.map((e) => e.line).join(", ")}: ${r.errors[0].error}` : ""].filter(Boolean).join(" ") || undefined,
      }),
    });
    if (outcome?.ok) {
      if (paste.current) paste.current.value = "";
      if (outcome.result.added) record("guests", outcome.result.added === 1 ? "added a guest" : `added ${outcome.result.added} guests`);
    }
  }

  async function remove(g: GuestRow) {
    const outcome = await mutate({ apply: (list) => list.filter((x) => x.id !== g.id), action: () => removeGuestAction(bookingId, g.id), failure: `Couldn't remove ${g.name}` });
    if (outcome.ok) record("guests", `removed ${g.name}`);
  }

  async function setAttended(ids: string[], on: boolean, label: string) {
    const outcome = await mutateAttended({
      apply: (a) => {
        const next = { ...a };
        for (const id of ids) {
          if (on) next[id] = next[id] ?? new Date().toISOString();
          else delete next[id];
        }
        return next;
      },
      action: () => setAttendanceAction(bookingId, ids, on),
      failure: `Couldn't update check-in for ${label}`,
    });
    if (outcome.ok && ids.length > 1) record("rsvp", `checked in ${ids.length} guests`);
  }
  const goingNotIn = rows.filter((g) => g.status === "ACCEPTED" && !attended[g.id]).map((g) => g.id);
  const showCheckIn = Boolean(checkIn?.ready);

  async function setStatus(g: GuestRow, status: RsvpStatus) {
    const outcome = await mutate({
      apply: (list) => list.map((x) => (x.id === g.id ? { ...x, status, plusOnes: status === "DECLINED" ? 0 : x.plusOnes } : x)),
      action: () => setGuestStatusAction(bookingId, g.id, status),
      failure: `Couldn't update ${g.name}`,
    });
    if (outcome.ok) record("rsvp", `marked ${g.name} as ${RSVP_LABEL[status].toLowerCase()}`);
  }

  return (
    <div className="grid gap-4">
      {!readOnly ? (
        <form action={addGuests} className="grid gap-2">
          <Label htmlFor="guests">Add guests, one per line</Label>
          <textarea
            ref={paste}
            id="guests"
            rows={3}
            placeholder={"Asha Rao <asha@nimbus.in>\nDev Iyer, dev@nimbus.in"}
            className="field-sizing-content min-h-20 resize-none rounded-md border border-line bg-surface px-3 py-2 font-mono text-[13px] text-fg placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-fg-subtle text-[12px]">Paste from a spreadsheet or email: names are optional, duplicates are skipped.</span>
            <Button type="submit" disabled={add.pending} className="min-h-11 sm:min-h-9">
              {add.pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />} Add
            </Button>
          </div>
        </form>
      ) : null}

      {showCheckIn && rows.length > 0 ? (
        <div className="bg-surface-raised flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-[12.5px]">
          <span className="text-fg">
            <span className="font-medium tabular-nums">{Object.keys(attended).length}</span> attended
          </span>
          {checkIn?.canMark ? (
            <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={goingNotIn.length === 0} onClick={() => void setAttended(goingNotIn, true, "everyone going")}>
              <CheckCheck aria-hidden /> Mark all Going as attended{goingNotIn.length ? ` (${goingNotIn.length})` : ""}
            </Button>
          ) : (
            <span className="text-fg-subtle ml-auto">{checkIn?.reason}</span>
          )}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState compact icon={Users} title="No guests yet" description={readOnly ? "The organisers haven't added anyone." : "Paste names and emails above. Each guest gets a personal RSVP link, and replies show up here live."} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guest</TableHead>
              <TableHead>Reply</TableHead>
              {showCheckIn ? <TableHead>Attended</TableHead> : null}
              <TableHead className="text-right">+ guests</TableHead>
              <TableHead>Dietary</TableHead>
              <TableHead className="text-right">RSVP link</TableHead>
              {!readOnly ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-fg-subtle font-mono text-[12px]">{g.email}</div>
                </TableCell>
                <TableCell>
                  {readOnly ? (
                    <span className={cn("text-[13px]", STATUS_TONE[g.status])}>{RSVP_LABEL[g.status]}</span>
                  ) : (
                    <NativeSelect aria-label={`Reply for ${g.name}`} value={g.status} onChange={(e) => void setStatus(g, e.target.value as RsvpStatus)} className={cn("h-8 w-36 text-[13px]", STATUS_TONE[g.status])}>
                      {RSVP_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {RSVP_LABEL[s]}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </TableCell>
                {showCheckIn ? (
                  <TableCell>
                    {checkIn?.canMark ? (
                      <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={Boolean(attended[g.id])} onChange={(e) => void setAttended([g.id], e.target.checked, g.name)} className="accent-fg size-4" aria-label={`${g.name} attended`} />
                        {attended[g.id] ? <span className="text-sage">Attended</span> : <span className="text-fg-faint">—</span>}
                      </label>
                    ) : attended[g.id] ? (
                      <span className="text-sage text-[13px]">Attended</span>
                    ) : (
                      <span className="text-fg-faint text-[13px]">—</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums">{g.plusOnes || <span className="text-fg-faint">—</span>}</TableCell>
                <TableCell className="max-w-48 truncate text-[13px]" title={g.dietary ?? undefined}>
                  {g.dietary ?? <span className="text-fg-faint">—</span>}
                </TableCell>
                <TableCell className="text-right">
                  <CopyButton text={g.rsvpUrl} label="Copy" />
                </TableCell>
                {!readOnly ? (
                  <TableCell className="text-right">
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${g.name}`} onClick={() => void remove(g)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
