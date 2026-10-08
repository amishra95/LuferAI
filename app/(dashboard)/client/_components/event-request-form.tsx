"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BadgePercent, Check, CheckCircle2, Hourglass, Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  BOOKING_STEPS,
  NOTES_MAX,
  stepOf,
  validateBookingForm,
  validateBookingStep,
  type BookingFormField,
  type BookingFormInput,
  type BookingSchemaContext,
} from "@/lib/bookings/request-schema";
import { calculateGst, normalizeGstin, validateGstin } from "@/lib/gst-engine";
import type { NegotiatedPricing } from "@/lib/rates/apply-rate-card";
import { cn, formatDate, formatINR } from "@/lib/utils";
import {
  getUnavailableDates,
  previewNegotiatedRate,
  releaseCheckoutSlot,
  reserveCheckoutSlot,
  submitBookingRequest,
  type BookingRequestState,
  type CheckoutSlotState,
} from "../actions";
import { VenuePicker, type VenuePickerOption } from "./venue-picker";

/** Values chosen elsewhere (e.g. an AI search result) to load into the form. */
export interface VenuePrefill {
  venueId: string;
  partySize: number;
  perHead: number;
}

export type VenueOption = VenuePickerOption & { gstin: string };

type Errors = Partial<Record<BookingFormField, string>>;

const EMPTY: BookingFormInput = {
  venue_id: "",
  event_date: "",
  party_size: "",
  budget_per_head_inr: "",
  department_id: "",
  cost_center: "",
  project_code: "",
  billing_gstin: "",
  notes: "",
};

/**
 * Booking request in three steps: Event (venue, date, guests, budget, with live
 * availability, a slot hold and the negotiated rate), Billing (department and
 * finance codes) and Review (summary and GST breakdown). Each step is checked
 * with the shared Zod schema (lib/bookings/request-schema.ts) before moving on;
 * submitBookingRequest re-validates with the same schema and placeBookingRequest
 * runs the checks that need data. All inputs stay mounted (inactive steps are
 * hidden), so the server action receives every field.
 */
export function EventRequestForm({
  companyId,
  companyGstin,
  venues,
  departments = [],
  defaultVenueId = "",
  prefill,
}: {
  /** Used for the negotiated-rate preview; the server scopes it to the session's company. */
  companyId: string;
  companyGstin: string;
  venues: VenueOption[];
  departments?: { id: string; name: string }[];
  defaultVenueId?: string;
  /** Each new object overwrites venue, guests and budget and returns to the first step. */
  prefill?: VenuePrefill;
}) {
  const [state, formAction, pending] = useActionState<BookingRequestState, FormData>(submitBookingRequest, { status: "idle" });
  const [values, setValues] = useState<BookingFormInput>({ ...EMPTY, venue_id: defaultVenueId });
  const [step, setStep] = useState(0);
  const [clientErrors, setClientErrors] = useState<Errors>({});
  const set = (field: BookingFormField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // Editing a field clears its message until the step is checked again.
    setClientErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };
  const { venue_id: venueId, event_date: eventDate, party_size: partySize, budget_per_head_inr: perHead } = values;

  // Apply a new prefill while rendering rather than in an effect (React's
  // "adjusting state when a prop changes" pattern), so there's no flash of old values.
  const [appliedPrefill, setAppliedPrefill] = useState<VenuePrefill | undefined>(undefined);
  if (prefill && prefill !== appliedPrefill) {
    setAppliedPrefill(prefill);
    setValues((v) => ({ ...v, venue_id: prefill.venueId, party_size: String(prefill.partySize), budget_per_head_inr: String(prefill.perHead) }));
    setStep(0);
  }

  // A server response with field errors sends the user to the first step that has one.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    const fields = Object.keys(state.status === "error" ? (state.fieldErrors ?? {}) : {});
    if (fields.length) setStep(Math.min(...fields.map((f) => BOOKING_STEPS.findIndex((s) => s.id === stepOf(f)))));
  }

  const venue = venues.find((v) => v.id === venueId);

  // Server results are stored with the inputs they were fetched for and only
  // used while those inputs are current, so a slow response never shows stale data.
  const [locked, setLocked] = useState<{ venueId: string; dates: string[] }>();
  useEffect(() => {
    if (!venueId) return;
    let current = true;
    getUnavailableDates(venueId).then((dates) => current && setLocked({ venueId, dates }));
    return () => {
      current = false;
    };
    // Re-fetch after a submission too: the new booking's hold locks its date.
  }, [venueId, state]);
  const unavailableDates = locked?.venueId === venueId ? locked.dates : [];
  const dateUnavailable = Boolean(eventDate) && unavailableDates.includes(eventDate);

  // Checkout session: once a venue and date are chosen, lock that slot for this
  // user while they finish the form (released on change/unmount, consumed on submit).
  const slotKey = venueId && eventDate && !dateUnavailable ? `${venueId}|${eventDate}` : "";
  const [checkout, setCheckout] = useState<{ key: string; slot: CheckoutSlotState }>();
  useEffect(() => {
    if (!slotKey) return;
    const [v, d] = slotKey.split("|");
    let current = true;
    let heldToken: string | null = null;
    const timer = setTimeout(() => {
      reserveCheckoutSlot(v, d).then((slot) => {
        if (slot.status === "held") heldToken = slot.token;
        if (!current) {
          if (heldToken) void releaseCheckoutSlot(v, d, heldToken);
          return;
        }
        setCheckout({ key: slotKey, slot });
      });
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
      if (heldToken) void releaseCheckoutSlot(v, d, heldToken);
    };
  }, [slotKey]);
  const slot = checkout?.key === slotKey ? checkout.slot : null;
  const slotBusy = slot?.status === "busy";

  const pricingKey = [companyId, venueId, eventDate, partySize, perHead].join("|");
  const [rate, setRate] = useState<{ key: string; pricing: NegotiatedPricing | null }>();
  useEffect(() => {
    if (!venueId || !eventDate || !(Number(partySize) > 0) || !(Number(perHead) > 0)) return;
    let current = true;
    const timer = setTimeout(() => {
      previewNegotiatedRate({ companyId, venueId, eventDate, partySize: Number(partySize), perHead: Number(perHead) }).then(
        (pricing) => current && setRate({ key: pricingKey, pricing })
      );
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [pricingKey, companyId, venueId, eventDate, partySize, perHead]);
  const pricing = rate?.key === pricingKey ? rate.pricing : null;

  // GST is on what will actually be invoiced: the negotiated total once known.
  const total = pricing?.taxableTotal ?? Number(partySize) * Number(perHead);
  // The invoice follows the GSTIN being billed: a branch in another state switches CGST+SGST ↔ IGST.
  const billedGstin = values.billing_gstin && validateGstin(values.billing_gstin).valid ? normalizeGstin(values.billing_gstin) : companyGstin;
  const preview = useMemo(() => {
    if (!venue || !(total > 0)) return null;
    return calculateGst({ total_amount: total, company_gstin: billedGstin, venue_gstin: venue.gstin });
  }, [venue, total, billedGstin]);

  // Lazy initializers keep render pure (evaluated once on mount).
  const [minDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const schemaCtx: BookingSchemaContext = { today, capacity: venue?.capacity_max, venueName: venue?.name, companyGstin };

  const serverErrors: Errors = state.status === "error" && state === handledState ? (state.fieldErrors ?? {}) : {};
  const err = (f: BookingFormField) => clientErrors[f] ?? serverErrors[f];

  // Things the schema can't know that also stop the Event step.
  const belowMinimum = pricing !== null && !pricing.meetsMinimumSpend;
  const eventBlocked = dateUnavailable || slotBusy || belowMinimum;

  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // Move focus to the new step's heading (not on first render).
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);

  /** Checks the current step; on errors shows them and focuses the first invalid field. */
  function checkStep(index: number): boolean {
    const errors = validateBookingStep(values, schemaCtx, BOOKING_STEPS[index].id);
    setClientErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return false;
    }
    return !(index === 0 && eventBlocked);
  }

  function next() {
    if (checkStep(step)) setStep((s) => Math.min(s + 1, BOOKING_STEPS.length - 1));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Enter on an earlier step advances instead of submitting.
    if (step < BOOKING_STEPS.length - 1) {
      e.preventDefault();
      next();
      return;
    }
    const result = validateBookingForm(values, schemaCtx);
    if (!result.ok || eventBlocked) {
      e.preventDefault();
      if (!result.ok) {
        setClientErrors(result.errors);
        setStep(BOOKING_STEPS.findIndex((s) => s.id === stepOf(Object.keys(result.errors)[0])));
      } else setStep(0);
    }
  }

  function startOver() {
    setValues({ ...EMPTY, venue_id: venueId });
    setClientErrors({});
    setStep(0);
  }

  const succeeded = state.status === "success" && state === handledState;
  const current = BOOKING_STEPS[step];
  const departmentName = departments.find((d) => d.id === values.department_id)?.name;

  return (
    <form ref={form} action={formAction} onSubmit={onSubmit} noValidate className="grid gap-5">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="slot_token" value={slot?.status === "held" ? slot.token : ""} />

      {/* Progress: earlier steps can be revisited; later ones are reached with Next. */}
      <ol className="grid grid-cols-3 gap-2" aria-label="Booking request steps">
        {BOOKING_STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 border-t-2 pt-2.5 text-left font-mono text-[11px] tracking-wider uppercase transition-[color,border-color,transform] duration-200 active:scale-[0.98] pointer-coarse:min-h-11",
                  active ? "border-copper-deep text-fg font-medium" : done ? "border-fg text-fg hover:text-copper-ink" : "border-line text-fg-subtle"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10.5px]",
                    done ? "bg-fg text-canvas" : active ? "badge-pulse bg-copper-deep text-canvas" : "bg-surface-raised text-fg-subtle"
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                {s.title}
                <span className="sr-only">{done ? " (done)" : active ? " (current)" : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <h3 ref={heading} tabIndex={-1} className="sr-only">
        Step {step + 1} of {BOOKING_STEPS.length}: {current.title}
      </h3>

      {/* ── Step 1 · Event ─────────────────────────────────────────────── */}
      <div hidden={current.id !== "event"} className="animate-in fade-in slide-in-from-right-2 grid gap-4 duration-300 ease-out">
        <VenuePicker venues={venues} value={venueId} onChange={(id) => set("venue_id", id)} partySize={Number(partySize)} error={err("venue_id")} />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid content-start gap-2">
            <Label htmlFor="event_date">Event date</Label>
            <Input
              id="event_date"
              name="event_date"
              type="date"
              min={minDate}
              value={eventDate}
              onChange={(e) => set("event_date", e.target.value)}
              aria-invalid={Boolean(err("event_date")) || dateUnavailable}
              aria-describedby={unavailableDates.length > 0 ? "unavailable-dates" : undefined}
            />
            {dateUnavailable ? (
              <p className="text-destructive text-xs" role="alert">
                {venue?.name ?? "This venue"} is unavailable on this date. Choose another.
              </p>
            ) : err("event_date") ? (
              <FieldError message={err("event_date")} />
            ) : slot?.status === "busy" ? (
              <p className="text-destructive text-xs" role="alert">
                Someone else is booking this date right now. It frees up within {Math.max(1, Math.ceil(slot.retryAfterMs / 60_000))} min, or choose another.
              </p>
            ) : slot?.status === "held" ? (
              <p className="text-muted-foreground text-xs" role="status">
                Reserved for you until{" "}
                {new Date(slot.expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })} while you finish.
              </p>
            ) : null}
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="party_size">Guests</Label>
            <Input
              id="party_size"
              name="party_size"
              type="number"
              min={1}
              max={venue?.capacity_max}
              step={1}
              inputMode="numeric"
              value={partySize}
              onChange={(e) => set("party_size", e.target.value)}
              aria-invalid={Boolean(err("party_size"))}
            />
            <FieldError message={err("party_size")} />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="budget_per_head_inr">Budget / head (₹)</Label>
            <Input
              id="budget_per_head_inr"
              name="budget_per_head_inr"
              type="number"
              min={1}
              step="any"
              inputMode="decimal"
              value={perHead}
              onChange={(e) => set("budget_per_head_inr", e.target.value)}
              aria-invalid={Boolean(err("budget_per_head_inr")) || belowMinimum}
            />
            <FieldError message={err("budget_per_head_inr")} />
          </div>
        </div>

        {unavailableDates.length > 0 ? (
          <p id="unavailable-dates" className="text-muted-foreground -mt-2 text-xs">
            Unavailable at {venue?.name}: {unavailableDates.slice(0, 8).map(formatDate).join(", ")}
            {unavailableDates.length > 8 ? ` and ${unavailableDates.length - 8} more` : ""}
          </p>
        ) : null}

        {pricing ? <PricingPanel pricing={pricing} /> : null}
      </div>

      {/* ── Step 2 · Billing ───────────────────────────────────────────── */}
      <div hidden={current.id !== "billing"} className="animate-in fade-in slide-in-from-right-2 grid gap-4 duration-300 ease-out">
        {departments.length > 0 ? (
          <div className="grid content-start gap-2">
            <Label htmlFor="department_id">Charge to department</Label>
            <NativeSelect id="department_id" name="department_id" value={values.department_id} onChange={(e) => set("department_id", e.target.value)}>
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={err("department_id")} />
          </div>
        ) : (
          <input type="hidden" name="department_id" value="" />
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid content-start gap-2">
            <Label htmlFor="cost_center">Cost centre</Label>
            <Input
              id="cost_center"
              name="cost_center"
              value={values.cost_center}
              onChange={(e) => set("cost_center", e.target.value.toUpperCase())}
              placeholder="ENG-BLR"
              maxLength={32}
              aria-invalid={Boolean(err("cost_center"))}
              className="font-mono tracking-wider"
            />
            <FieldError message={err("cost_center")} />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="project_code">
              Project code
            </Label>
            <Input
              id="project_code"
              name="project_code"
              value={values.project_code}
              onChange={(e) => set("project_code", e.target.value.toUpperCase())}
              placeholder="Optional"
              maxLength={32}
              aria-invalid={Boolean(err("project_code"))}
              className="font-mono tracking-wider"
            />
            <FieldError message={err("project_code")} />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="billing_gstin">
              Billing GSTIN
            </Label>
            <Input
              id="billing_gstin"
              name="billing_gstin"
              value={values.billing_gstin}
              onChange={(e) => set("billing_gstin", e.target.value.toUpperCase())}
              placeholder={companyGstin}
              maxLength={15}
              aria-invalid={Boolean(err("billing_gstin"))}
              aria-describedby="billing-gstin-help"
              className="font-mono tracking-wider"
            />
            {err("billing_gstin") ? (
              <FieldError message={err("billing_gstin")} />
            ) : (
              <p id="billing-gstin-help" className="text-muted-foreground text-xs">
                Optional. Blank bills your registered GSTIN.
              </p>
            )}
          </div>
        </div>

        <div className="grid content-start gap-2">
          <Label htmlFor="notes">
            Notes for the venue <span className="text-fg-subtle font-normal">(optional)</span>
          </Label>
          <textarea
            id="notes"
            name="notes"
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Dietary needs, AV, seating, timings…"
            maxLength={NOTES_MAX}
            rows={3}
            aria-invalid={Boolean(err("notes"))}
            aria-describedby="notes-count"
            className="field min-h-20 resize-y py-2"
          />
          <p id="notes-count" className="text-fg-subtle text-right font-mono text-[11px] tabular-nums">
            {values.notes.length}/{NOTES_MAX}
          </p>
          <FieldError message={err("notes")} />
        </div>
      </div>

      {/* ── Step 3 · Review ────────────────────────────────────────────── */}
      <div hidden={current.id !== "review"} className="animate-in fade-in slide-in-from-right-2 grid gap-4 duration-300 ease-out">
        <dl className="divide-line border-line grid divide-y rounded-xl border text-sm">
          <ReviewRow label="Venue" onEdit={() => setStep(0)}>
            {venue ? `${venue.name}, ${venue.neighborhood}` : "—"}
          </ReviewRow>
          <ReviewRow label="Date & guests" onEdit={() => setStep(0)}>
            {eventDate ? formatDate(eventDate) : "—"} · <span className="figure">{partySize || "—"}</span> guests ·{" "}
            <span className="figure">
              {pricing && pricing.source !== "list" ? (
                <>
                  <s className="text-muted-foreground">{formatINR(pricing.listPerHead, true)}</s> {formatINR(pricing.negotiatedPerHead, true)}
                </>
              ) : (
                formatINR(Number(perHead) || 0, true)
              )}
            </span>{" "}
            / head
          </ReviewRow>
          <ReviewRow label="Billing" onEdit={() => setStep(1)}>
            <span className="figure">
              {values.cost_center || "—"}
              {values.project_code ? ` / ${values.project_code}` : ""}
            </span>
            {departmentName ? ` · ${departmentName}` : ""} · GSTIN <span className="figure">{billedGstin}</span>
          </ReviewRow>
          {values.notes ? (
            <ReviewRow label="Notes" onEdit={() => setStep(1)}>
              <span className="whitespace-pre-wrap">{values.notes}</span>
            </ReviewRow>
          ) : null}
        </dl>

        {preview ? (
          <dl className="border-line/60 bg-surface grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-2.5 rounded-xl border p-4 text-sm" aria-label="Invoice estimate">
            <dt className="label-mono">Taxable value</dt>
            <dd className="figure text-right">{formatINR(preview.taxable_value, true)}</dd>
            <dt className="label-mono">{preview.gst_type === "IGST" ? "IGST 18%" : "CGST 9% + SGST 9%"}</dt>
            <dd className="figure text-right">{formatINR(preview.total_tax, true)}</dd>
            <dt className="label-mono">Supply</dt>
            <dd className="figure text-right">{preview.supply_type === "INTER_STATE" ? "Inter-state" : "Intra-state"}</dd>
            {/* One unbroken rule above the total (a <div> may group a dt/dd pair). */}
            <div className="border-line col-span-2 mt-1 grid grid-cols-subgrid items-baseline border-t pt-3">
              <dt className="label-mono text-fg">Invoice total</dt>
              <dd className="figure text-right text-[15px] font-medium">{formatINR(preview.invoice_total, true)}</dd>
            </div>
          </dl>
        ) : null}
        <p className="text-fg-subtle text-xs">
          The venue gets the request once any required sign-off is done. Prices are re-checked against your company&apos;s rate card when you send.
        </p>
      </div>

      {/* ── Outcome & navigation ──────────────────────────────────────── */}
      {succeeded && state.approval ? (
        <div className="text-copper-ink animate-in fade-in flex gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm" role="status">
          <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{state.message}</p>
            <p className="text-muted-foreground mt-0.5">
              Sent for sign-off to {state.approval.approverName}
              {state.approval.tiers > 1 ? " (in that order)" : ""} because {state.approval.reason}. The venue sees it once approved
              {state.holdHours ? `; the date is held for ${state.holdHours} hours meanwhile` : ""}.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {step > 0 ? (
          <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={pending}>
            <ArrowLeft aria-hidden /> Back
          </Button>
        ) : null}
        {current.id !== "review" ? (
          // A submit button on every step, so Enter in a field works; onSubmit advances until the last step.
          <Button type="submit" disabled={current.id === "event" && eventBlocked}>
            Next: {BOOKING_STEPS[step + 1].title} <ArrowRight aria-hidden />
          </Button>
        ) : succeeded ? (
          <Button type="button" onClick={startOver}>
            Request another event
          </Button>
        ) : (
          <Button type="submit" disabled={pending || eventBlocked}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Send request
          </Button>
        )}
        {state.status === "error" && state.message && state === handledState ? (
          <p className="text-destructive text-sm" role="alert">
            {state.message}
          </p>
        ) : null}
        {succeeded && !state.approval ? (
          <p className="text-sage animate-in fade-in flex items-center gap-1.5 text-sm" role="status">
            <CheckCircle2 className="size-4" aria-hidden />
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-destructive text-xs">{message}</p> : null;
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <dt className="label-mono w-28 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-fg min-w-0 flex-1 break-words">{children}</dd>
      <button type="button" onClick={onEdit} className="text-fg-subtle hover:text-fg -my-1 inline-flex items-center gap-1 rounded px-1 py-1 text-xs pointer-coarse:min-h-11">
        <Pencil className="size-3" aria-hidden /> Edit<span className="sr-only"> {label.toLowerCase()}</span>
      </button>
    </div>
  );
}

function PricingPanel({ pricing }: { pricing: NegotiatedPricing }) {
  return (
    <div className="animate-in fade-in grid gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm duration-300" aria-live="polite">
      {pricing.source !== "list" ? (
        <p className="text-copper-ink flex items-center gap-1.5 font-medium">
          <BadgePercent className="size-4" aria-hidden />
          Your company&apos;s negotiated rate applies
        </p>
      ) : null}
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-2.5">
        <dt className="label-mono">Per head</dt>
        <dd className="figure text-right">
          {pricing.source !== "list" ? (
            <>
              <s className="text-muted-foreground">{formatINR(pricing.listPerHead, true)}</s> {formatINR(pricing.negotiatedPerHead, true)}
            </>
          ) : (
            formatINR(pricing.listPerHead, true)
          )}
        </dd>
        <dt className="label-mono">Minimum spend</dt>
        <dd className="figure text-right">{formatINR(pricing.minimumSpend)}</dd>
        {pricing.savings > 0 ? (
          <>
            <dt className="label-mono">You save</dt>
            <dd className="figure text-sage text-right">{formatINR(pricing.savings, true)}</dd>
          </>
        ) : null}
      </dl>
      {!pricing.meetsMinimumSpend ? (
        <p className="text-destructive text-xs" role="alert">
          {formatINR(pricing.taxableTotal)} is below the {formatINR(pricing.minimumSpend)} minimum spend. Add guests or raise the budget.
        </p>
      ) : null}
    </div>
  );
}
