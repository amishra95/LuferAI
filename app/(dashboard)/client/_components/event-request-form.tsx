"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { BadgePercent, CheckCircle2, Hourglass, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { calculateGst, normalizeGstin, validateGstin } from "@/lib/gst-engine";
import type { Venue } from "@/lib/supabase/database.types";
import type { NegotiatedPricing } from "@/lib/rates/apply-rate-card";
import { formatDate, formatINR } from "@/lib/utils";
import {
  getUnavailableDates,
  previewNegotiatedRate,
  submitBookingRequest,
  type BookingRequestState,
} from "../actions";

/** Values chosen elsewhere (e.g. an AI search result) to load into the form. */
export interface VenuePrefill {
  venueId: string;
  partySize: number;
  perHead: number;
}

type VenueOption = Pick<Venue, "id" | "name" | "neighborhood" | "city" | "gstin" | "capacity_max" | "min_spend_inr" | "pdr_available">;

export function EventRequestForm({
  companyId,
  userId,
  companyGstin,
  venues,
  prefill,
}: {
  companyId: string;
  /** Acting employee; needed when a booking must be routed for sign-off. */
  userId?: string;
  companyGstin: string;
  venues: VenueOption[];
  /** Each new object overwrites venue, guests and budget; the user can still edit them. */
  prefill?: VenuePrefill;
}) {
  const [state, formAction, pending] = useActionState<BookingRequestState, FormData>(submitBookingRequest, {
    status: "idle",
  });
  const [venueId, setVenueId] = useState("");
  const [partySize, setPartySize] = useState("");
  const [perHead, setPerHead] = useState("");
  const [eventDate, setEventDate] = useState("");
  // Finance fields are controlled so they survive a failed submit (React resets uncontrolled inputs).
  const [costCenter, setCostCenter] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [billingGstin, setBillingGstin] = useState("");

  // Apply a new prefill while rendering rather than in an effect (React's
  // "adjusting state when a prop changes" pattern), so there's no flash of old values.
  const [appliedPrefill, setAppliedPrefill] = useState<VenuePrefill | undefined>(undefined);
  if (prefill && prefill !== appliedPrefill) {
    setAppliedPrefill(prefill);
    setVenueId(prefill.venueId);
    setPartySize(String(prefill.partySize));
    setPerHead(String(prefill.perHead));
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
  const billedGstin = billingGstin && validateGstin(billingGstin).valid ? normalizeGstin(billingGstin) : companyGstin;
  const preview = useMemo(() => {
    if (!venue || !(total > 0)) return null;
    return calculateGst({ total_amount: total, company_gstin: billedGstin, venue_gstin: venue.gstin });
  }, [venue, total, billedGstin]);

  const err = state.status === "error" ? state.fieldErrors ?? {} : {};
  // Lazy initializer keeps render pure (evaluated once on mount).
  const [minDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="company_id" value={companyId} />
      {userId ? <input type="hidden" name="user_id" value={userId} /> : null}

      <div className="grid gap-2">
        <Label htmlFor="venue_id">Venue</Label>
        <NativeSelect
          id="venue_id"
          name="venue_id"
          value={venueId}
          onChange={(e) => setVenueId(e.target.value)}
          aria-invalid={Boolean(err.venue_id)}
          required
        >
          <option value="" disabled>
            Select a venue…
          </option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} — {v.neighborhood}
            </option>
          ))}
        </NativeSelect>
        {venue ? (
          <p className="text-muted-foreground text-xs">
            Up to {venue.capacity_max} guests · min spend {formatINR(Number(venue.min_spend_inr))}
            {venue.pdr_available ? " · private dining room" : ""}
          </p>
        ) : null}
        {err.venue_id ? <p className="text-destructive text-xs">{err.venue_id}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="event_date">Event date</Label>
          <Input
            id="event_date"
            name="event_date"
            type="date"
            min={minDate}
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            required
            aria-invalid={Boolean(err.event_date) || dateUnavailable}
            aria-describedby={unavailableDates.length > 0 ? "unavailable-dates" : undefined}
          />
          {dateUnavailable ? (
            <p className="text-destructive text-xs" role="alert">
              {venue?.name ?? "This venue"} is unavailable on this date. Choose another.
            </p>
          ) : err.event_date ? (
            <p className="text-destructive text-xs">{err.event_date}</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="party_size">Guests</Label>
          <Input
            id="party_size"
            name="party_size"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
            required
            aria-invalid={Boolean(err.party_size)}
          />
          {err.party_size ? <p className="text-destructive text-xs">{err.party_size}</p> : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="budget_per_head_inr">Budget / head (₹)</Label>
          <Input
            id="budget_per_head_inr"
            name="budget_per_head_inr"
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            value={perHead}
            onChange={(e) => setPerHead(e.target.value)}
            required
            aria-invalid={Boolean(err.budget_per_head_inr)}
          />
          {err.budget_per_head_inr ? <p className="text-destructive text-xs">{err.budget_per_head_inr}</p> : null}
        </div>
      </div>

      {unavailableDates.length > 0 ? (
        <p id="unavailable-dates" className="text-muted-foreground -mt-2 text-xs">
          Unavailable at {venue?.name}: {unavailableDates.slice(0, 8).map(formatDate).join(", ")}
          {unavailableDates.length > 8 ? ` and ${unavailableDates.length - 8} more` : ""}
        </p>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="text-fg mb-3 text-[13px] font-medium">Finance</legend>
        <div className="grid gap-2">
          <Label htmlFor="cost_center">Cost centre</Label>
          <Input
            id="cost_center"
            name="cost_center"
            value={costCenter}
            onChange={(e) => setCostCenter(e.target.value.toUpperCase())}
            placeholder="ENG-BLR"
            maxLength={32}
            required
            aria-invalid={Boolean(err.cost_center)}
            className="font-mono"
          />
          {err.cost_center ? <p className="text-destructive text-xs">{err.cost_center}</p> : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="project_code">Project code</Label>
          <Input
            id="project_code"
            name="project_code"
            value={projectCode}
            onChange={(e) => setProjectCode(e.target.value.toUpperCase())}
            placeholder="Optional"
            maxLength={32}
            aria-invalid={Boolean(err.project_code)}
            className="font-mono"
          />
          {err.project_code ? <p className="text-destructive text-xs">{err.project_code}</p> : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="billing_gstin">Billing GSTIN</Label>
          <Input
            id="billing_gstin"
            name="billing_gstin"
            value={billingGstin}
            onChange={(e) => setBillingGstin(e.target.value.toUpperCase())}
            placeholder={companyGstin}
            maxLength={15}
            aria-invalid={Boolean(err.billing_gstin)}
            className="font-mono"
          />
          {err.billing_gstin ? (
            <p className="text-destructive text-xs">{err.billing_gstin}</p>
          ) : (
            <p className="text-muted-foreground text-xs">Blank bills your registered GSTIN.</p>
          )}
        </div>
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="notes">Notes for the venue</Label>
        <Input id="notes" name="notes" placeholder="Dietary needs, AV, seating, timings…" maxLength={500} />
      </div>

      {pricing ? (
        <div className="grid gap-1 rounded-lg border p-3 text-sm" aria-live="polite">
          {pricing.source !== "list" ? (
            <p className="flex items-center gap-1.5 font-medium">
              <BadgePercent className="size-4" aria-hidden />
              Your company&apos;s negotiated rate applies
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <dt className="text-muted-foreground">Per head</dt>
            <dd className="tabular-nums">
              {pricing.source !== "list" ? (
                <>
                  <s className="text-muted-foreground">{formatINR(pricing.listPerHead, true)}</s>{" "}
                  {formatINR(pricing.negotiatedPerHead, true)}
                </>
              ) : (
                formatINR(pricing.listPerHead, true)
              )}
            </dd>
            <dt className="text-muted-foreground">Minimum spend</dt>
            <dd className="tabular-nums">{formatINR(pricing.minimumSpend)}</dd>
            {pricing.savings > 0 ? (
              <>
                <dt className="text-muted-foreground">You save</dt>
                <dd className="text-success tabular-nums">{formatINR(pricing.savings, true)}</dd>
              </>
            ) : null}
          </dl>
          {!pricing.meetsMinimumSpend ? (
            <p className="text-destructive text-xs">
              {formatINR(pricing.taxableTotal)} is below the {formatINR(pricing.minimumSpend)} minimum spend. Add guests or raise
              the budget.
            </p>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <dl className="bg-muted/60 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg p-3 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">Taxable value</dt>
          <dd className="text-right tabular-nums sm:text-left">{formatINR(preview.taxable_value, true)}</dd>
          <dt className="text-muted-foreground">{preview.gst_type === "IGST" ? "IGST 18%" : "CGST 9% + SGST 9%"}</dt>
          <dd className="text-right tabular-nums sm:text-left">{formatINR(preview.total_tax, true)}</dd>
          <dt className="font-medium">Invoice total</dt>
          <dd className="text-right font-medium tabular-nums sm:text-left">{formatINR(preview.invoice_total, true)}</dd>
          <dt className="text-muted-foreground">Supply</dt>
          <dd className="text-right sm:text-left">{preview.supply_type === "INTER_STATE" ? "Inter-state" : "Intra-state"}</dd>
        </dl>
      ) : null}

      {state.status === "success" && state.approval ? (
        <div className="border-warning/40 bg-warning/10 flex gap-3 rounded-lg border p-3 text-sm" role="status">
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
        <Button type="submit" disabled={pending || dateUnavailable}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Send request
        </Button>
        {state.status === "error" && state.message ? (
          <p className="text-destructive text-sm" role="alert">
            {state.message}
          </p>
        ) : null}
        {state.status === "success" && !state.approval ? (
          <p className="text-success flex items-center gap-1.5 text-sm" role="status">
            <CheckCircle2 className="size-4" aria-hidden />
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
