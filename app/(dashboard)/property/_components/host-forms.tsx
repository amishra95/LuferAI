"use client";

import { useActionState, useEffect, useState } from "react";
import { CalendarX2, FileSignature, Loader2, Plus, X } from "lucide-react";

import { blockDatesAction, counterRfpAction, createDirectQuoteAction, type HostFormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn, formatINR } from "@/lib/utils";

export const IDLE: HostFormState = { status: "idle" };

export interface HostPackage {
  id: string;
  name: string;
  per_head_inr: number;
  is_active: boolean;
}

export function Feedback({ state }: { state: HostFormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={cn("text-meta leading-5", state.status === "error" ? "text-rose" : "text-sage")}>
      {state.message}
    </p>
  );
}

/**
 * Closes an inline form once its action succeeds (the message stays on the
 * trigger row). Runs only when a new result arrives, so reopening stays open.
 */
function useCloseOnSuccess(state: HostFormState, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state, setOpen]);
}

/** "+ Block dates": marks a date or range unavailable to clients. */
export function BlockDates({ venueId, today, disabledReason, compact = false }: { venueId: string; today: string; disabledReason?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(blockDatesAction, IDLE);
  useCloseOnSuccess(state, setOpen);

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button type="button" size={compact ? "sm" : "default"} onClick={() => setOpen(true)} disabled={Boolean(disabledReason)} title={disabledReason}>
          <Plus aria-hidden /> Block dates
        </Button>
        {disabledReason ? <span className="text-fg-subtle text-caption">{disabledReason}</span> : <Feedback state={state} />}
      </div>
    );
  }
  return (
    <form action={action} className="border-line bg-surface grid w-full gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
      <input type="hidden" name="venue_id" value={venueId} />
      <label className="grid gap-1 text-meta">
        <span className="text-fg-subtle">From</span>
        <Input name="from" type="date" min={today} required autoFocus />
      </label>
      <label className="grid gap-1 text-meta">
        <span className="text-fg-subtle">To (optional)</span>
        <Input name="to" type="date" min={today} />
      </label>
      <label className="grid gap-1 text-meta">
        <span className="text-fg-subtle">Reason (only you see it)</span>
        <Input name="reason" maxLength={120} placeholder="e.g. Maintenance, private event" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarX2 aria-hidden />} Block
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Cancel">
          <X aria-hidden />
        </Button>
      </div>
      <div className="sm:col-span-4">
        <Feedback state={state} />
      </div>
    </form>
  );
}

/** Counter or decline an RFP, with the host's guardrails shown and enforced. */
export function RfpCounterForm({
  venueId,
  responseId,
  currentPerHead,
  currentPackageId,
  packages,
  lowestAllowed,
}: {
  venueId: string;
  responseId: string;
  currentPerHead: number | null;
  currentPackageId: string | null;
  packages: HostPackage[];
  /** Lowest per-head price the guardrails allow for this RFP, or 0 when nothing binds. */
  lowestAllowed: number;
}) {
  const [state, action, pending] = useActionState(counterRfpAction, IDLE);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="response_id" value={responseId} />
      <input type="hidden" name="venue_id" value={venueId} />
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <Input name="per_head_inr" type="number" min={1} step="any" placeholder="₹ / head" aria-label="Per-head price" defaultValue={currentPerHead ?? undefined} />
        <div className="grid gap-2 sm:grid-cols-2">
          <NativeSelect name="menu_package_id" aria-label="Menu package" defaultValue={currentPackageId ?? ""}>
            <option value="">No package</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatINR(p.per_head_inr)}
                {p.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </NativeSelect>
          <Input name="notes" placeholder="Note to client (optional)" aria-label="Note to client" maxLength={280} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="counter" size="sm" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Counter
          </Button>
          <Button type="submit" name="intent" value="decline" size="sm" variant="outline" formNoValidate disabled={pending}>
            Decline
          </Button>
        </div>
      </div>
      {lowestAllowed > 0 && state.status !== "error" ? (
        <p className="text-fg-subtle text-caption">Your guardrails allow {formatINR(lowestAllowed)} a head or more for this request.</p>
      ) : null}
      <Feedback state={state} />
    </form>
  );
}

/** "Create direct quote": quote a client you work with; it lands in their RFP comparisons. */
export function DirectQuote({
  venueId,
  companies,
  packages,
  today,
  disabledReason,
  size = "default",
  defaultCompanyId,
  label = "Create direct quote",
}: {
  venueId: string;
  companies: { id: string; name: string }[];
  packages: HostPackage[];
  today: string;
  disabledReason?: string;
  size?: "default" | "sm";
  /** Pre-selects the client (e.g. from an account's suggested next step). */
  defaultCompanyId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createDirectQuoteAction, IDLE);
  const reason = disabledReason ?? (companies.length === 0 ? "You can quote companies once they've booked you or sent you an RFP." : undefined);
  useCloseOnSuccess(state, setOpen);

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)} disabled={Boolean(reason)} title={reason}>
          <FileSignature aria-hidden /> {label}
        </Button>
        {reason ? <span className="text-fg-subtle max-w-72 text-caption">{reason}</span> : <Feedback state={state} />}
      </div>
    );
  }
  return (
    <form action={action} className="border-line bg-surface grid w-full gap-3 rounded-lg border p-4 sm:grid-cols-2">
      <input type="hidden" name="venue_id" value={venueId} />
      <h3 className="label-mono sm:col-span-2">Direct quote</h3>
      <label className="grid gap-1 text-meta sm:col-span-2">
        <span className="text-fg-subtle">Client</span>
        <NativeSelect name="company_id" required defaultValue={defaultCompanyId ?? ""}>
          <option value="" disabled>
            Choose a client
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name.replace(" Private Limited", "")}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1 text-meta">
        <span className="text-fg-subtle">Event date</span>
        <Input name="event_date" type="date" min={today} required />
      </label>
      <label className="grid gap-1 text-meta">
        <span className="text-fg-subtle">Guests</span>
        <Input name="party_size" type="number" min={1} step={1} required />
      </label>
      <label className="grid gap-1 text-meta">
        <span className="text-fg-subtle">Per head (₹, pre-GST)</span>
        <Input name="per_head_inr" type="number" min={1} step="any" required />
      </label>
      <label className="grid gap-1 text-meta">
        <span className="text-fg-subtle">Menu package</span>
        <NativeSelect name="menu_package_id" defaultValue="">
          <option value="">No package</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatINR(p.per_head_inr)}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1 text-meta sm:col-span-2">
        <span className="text-fg-subtle">Note to client (optional)</span>
        <Input name="notes" maxLength={280} placeholder="What's included, terms, validity" />
      </label>
      <p className="text-fg-subtle text-caption sm:col-span-2">Checked against your capacity, the date&apos;s availability and your guardrails. GST is added on the client&apos;s side.</p>
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FileSignature aria-hidden />} Send quote
        </Button>
      </div>
    </form>
  );
}
