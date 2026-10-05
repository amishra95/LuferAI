"use client";

import { useActionState, useMemo, useState } from "react";
import { CheckCircle2, Hourglass, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { calculateGst } from "@/lib/gst-engine";
import type { Venue } from "@/lib/supabase/database.types";
import { formatINR } from "@/lib/utils";
import { submitBookingRequest, type BookingRequestState } from "../actions";

type VenueOption = Pick<Venue, "id" | "name" | "neighborhood" | "city" | "gstin" | "capacity_max" | "min_spend_inr" | "pdr_available">;

export function EventRequestForm({
  companyId,
  userId,
  companyGstin,
  venues,
}: {
  companyId: string;
  /** Acting employee; needed when a booking must be routed for sign-off. */
  userId?: string;
  companyGstin: string;
  venues: VenueOption[];
}) {
  const [state, formAction, pending] = useActionState<BookingRequestState, FormData>(submitBookingRequest, {
    status: "idle",
  });
  const [venueId, setVenueId] = useState("");
  const [partySize, setPartySize] = useState("");
  const [perHead, setPerHead] = useState("");

  const venue = venues.find((v) => v.id === venueId);
  const total = Number(partySize) * Number(perHead);

  const preview = useMemo(() => {
    if (!venue || !(total > 0)) return null;
    return calculateGst({ total_amount: total, company_gstin: companyGstin, venue_gstin: venue.gstin });
  }, [venue, total, companyGstin]);

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
          <Input id="event_date" name="event_date" type="date" min={minDate} required aria-invalid={Boolean(err.event_date)} />
          {err.event_date ? <p className="text-destructive text-xs">{err.event_date}</p> : null}
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

      <div className="grid gap-2">
        <Label htmlFor="notes">Notes for the venue</Label>
        <Input id="notes" name="notes" placeholder="Dietary needs, AV, seating, timings…" maxLength={500} />
      </div>

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
              Sent to {state.approval.approverName} because {state.approval.reason}. The venue sees it once approved.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
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
