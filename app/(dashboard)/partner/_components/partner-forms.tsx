"use client";

import { useActionState } from "react";
import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PARTNER_ROLE_LABEL, PARTNER_ROLES } from "@/lib/auth/partner-rbac";
import { submitWithoutReset } from "@/lib/form-submit";
import { cn } from "@/lib/utils";
import {
  changeMemberAction,
  deleteListingAction,
  deleteRateCardAction,
  inviteMemberAction,
  saveListingAction,
  saveRateCardAction,
  setListingStatusAction,
  type PartnerFormState,
} from "../actions";

const IDLE: PartnerFormState = { status: "idle" };
type Action = (prev: PartnerFormState, form: FormData) => Promise<PartnerFormState>;

/** Inline result: icon + text, so success/failure never relies on colour alone. */
function Feedback({ state }: { state: PartnerFormState }) {
  if (state.status === "idle" || !state.message) return null;
  const ok = state.status === "success";
  return (
    <p role={ok ? "status" : "alert"} className={cn("flex items-center gap-1.5 text-[12.5px]", ok ? "text-sage" : "text-rose")}>
      {ok ? <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden /> : <X className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
      {state.message}
    </p>
  );
}

function Field({
  label,
  name,
  error,
  className,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; name: string; error?: string; hint?: string }) {
  const id = `${name}-${props.id ?? "f"}`;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input {...props} id={id} name={name} aria-invalid={Boolean(error)} />
      {error ? <p className="text-rose text-xs">{error}</p> : hint ? <p className="text-fg-subtle text-xs">{hint}</p> : null}
    </div>
  );
}

/** Admins act for the partner they're viewing; partner users' own partner comes from the session. */
function PartnerField({ partnerId }: { partnerId: string | null }) {
  return partnerId ? <input type="hidden" name="partner_id" value={partnerId} /> : null;
}

// ----------------------------------------------------------------------------
// Listings
// ----------------------------------------------------------------------------

export interface ListingValues {
  id: string;
  ref: string;
  name: string;
  area: string;
  city: string;
  address: string;
  capacity: number;
  min_spend_inr: number;
  private_dining: boolean;
}

export function ListingForm({ partnerId, listing }: { partnerId: string | null; listing?: ListingValues }) {
  const [state, action, pending] = useActionState<PartnerFormState, FormData>(saveListingAction, IDLE);
  const err = state.fieldErrors ?? {};
  const key = listing?.id ?? "new";
  return (
    <form onSubmit={submitWithoutReset(action)} className="grid gap-4">
      <PartnerField partnerId={partnerId} />
      {listing ? <input type="hidden" name="id" value={listing.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={key} label="Name" name="name" defaultValue={listing?.name} required maxLength={120} error={err.name} />
        <Field id={key} label="Reference" name="ref" defaultValue={listing?.ref} required maxLength={32} placeholder="BVX-200" className="font-mono" error={err.ref} hint="Your own code for this venue." />
        <Field id={key} label="Area" name="area" defaultValue={listing?.area} required maxLength={80} placeholder="Indiranagar" error={err.area} />
        <Field id={key} label="City" name="city" defaultValue={listing?.city ?? "Bengaluru"} required maxLength={80} error={err.city} />
        <Field id={key} label="Address" name="address" defaultValue={listing?.address} maxLength={200} className="sm:col-span-2" error={err.address} />
        <Field id={key} label="Capacity (guests)" name="capacity" type="number" min={1} max={5000} defaultValue={listing?.capacity} required error={err.capacity} />
        <Field id={key} label="Minimum spend (₹, pre-GST)" name="min_spend_inr" type="number" min={0} step="1" defaultValue={listing?.min_spend_inr ?? 0} error={err.min_spend_inr} />
        <label className="text-fg flex items-center gap-2 self-end pb-2 text-[13px]">
          <input type="checkbox" name="private_dining" defaultChecked={listing?.private_dining} className="accent-fg size-4" />
          Private dining room
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {listing ? "Save listing" : "Add listing"}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

/** A one-click action (pause, resume, delete) with its own pending/result state. */
function ActionButton({
  action,
  fields,
  children,
  variant = "outline",
  confirm,
}: {
  action: Action;
  fields: Record<string, string | null>;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  confirm?: string;
}) {
  const [state, run, pending] = useActionState<PartnerFormState, FormData>(action, IDLE);
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-col items-end gap-1"
    >
      {Object.entries(fields).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={v} />))}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </Button>
      {state.status === "error" ? <span role="alert" className="text-rose max-w-56 text-right text-[11.5px]">{state.message}</span> : null}
    </form>
  );
}

export function ListingStatusButton({ partnerId, id, status }: { partnerId: string | null; id: string; status: string }) {
  const next = status === "active" ? "paused" : "active";
  return (
    <ActionButton action={setListingStatusAction} fields={{ partner_id: partnerId, id, status: next }}>
      {next === "paused" ? "Pause" : "Resume"}
    </ActionButton>
  );
}

export function DeleteListingButton({ partnerId, id, name }: { partnerId: string | null; id: string; name: string }) {
  return (
    <ActionButton action={deleteListingAction} fields={{ partner_id: partnerId, id }} variant="ghost" confirm={`Delete ${name} and all its rate cards?`}>
      Delete
    </ActionButton>
  );
}

// ----------------------------------------------------------------------------
// Rate cards
// ----------------------------------------------------------------------------

export function RateCardForm({ partnerId, listings, minDate }: { partnerId: string | null; listings: { id: string; name: string }[]; minDate: string }) {
  const [state, action, pending] = useActionState<PartnerFormState, FormData>(saveRateCardAction, IDLE);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitWithoutReset(action)} className="grid gap-4">
      <PartnerField partnerId={partnerId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="rate-listing">Listing</Label>
          <NativeSelect id="rate-listing" name="partner_venue_id" required defaultValue="" aria-invalid={Boolean(err.partner_venue_id)}>
            <option value="" disabled>
              Choose a listing
            </option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
          {err.partner_venue_id ? <p className="text-rose text-xs">{err.partner_venue_id}</p> : null}
        </div>
        <Field id="rate" label="Label" name="label" required maxLength={80} placeholder="Weekday dinner" error={err.label} />
        <Field id="rate" label="Per head (₹, pre-GST)" name="per_head_inr" type="number" min={1} step="1" required error={err.per_head_inr} />
        <Field id="rate" label="Applies from (guests)" name="min_guests" type="number" min={1} max={5000} defaultValue={1} error={err.min_guests} hint="Add a separate rate for larger groups." />
        <Field id="rate" label="Valid from" name="valid_from" type="date" defaultValue={minDate} required error={err.valid_from} />
        <Field id="rate" label="Valid to" name="valid_to" type="date" error={err.valid_to} hint="Leave blank for open-ended." />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || listings.length === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Publish rate
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function DeleteRateButton({ partnerId, id, label }: { partnerId: string | null; id: string; label: string }) {
  return (
    <ActionButton action={deleteRateCardAction} fields={{ partner_id: partnerId, id }} variant="ghost" confirm={`Delete the rate "${label}"?`}>
      Delete
    </ActionButton>
  );
}

// ----------------------------------------------------------------------------
// Team
// ----------------------------------------------------------------------------

export function InviteForm({ partnerId }: { partnerId: string | null }) {
  const [state, action, pending] = useActionState<PartnerFormState, FormData>(inviteMemberAction, IDLE);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitWithoutReset(action)} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
      <PartnerField partnerId={partnerId} />
      <Field id="invite" label="Email" name="email" type="email" required autoComplete="off" error={err.email} />
      <div className="grid gap-1.5">
        <Label htmlFor="invite-role">Role</Label>
        <NativeSelect id="invite-role" name="partner_role" defaultValue="STAFF">
          {PARTNER_ROLES.map((r) => (
            <option key={r} value={r}>
              {PARTNER_ROLE_LABEL[r]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Invite
      </Button>
      <div className="sm:col-span-3">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function MemberRoleForm({ partnerId, userId, role, email }: { partnerId: string | null; userId: string; role: string; email: string }) {
  const [state, action, pending] = useActionState<PartnerFormState, FormData>(changeMemberAction, IDLE);
  return (
    <form onSubmit={submitWithoutReset(action)} className="flex flex-wrap items-center justify-end gap-2">
      <PartnerField partnerId={partnerId} />
      <input type="hidden" name="user_id" value={userId} />
      <label htmlFor={`role-${userId}`} className="sr-only">
        Role for {email}
      </label>
      <NativeSelect id={`role-${userId}`} name="partner_role" defaultValue={role} className="h-8 w-36">
        {PARTNER_ROLES.map((r) => (
          <option key={r} value={r}>
            {PARTNER_ROLE_LABEL[r]}
          </option>
        ))}
        <option value="REMOVE">Remove from team</option>
      </NativeSelect>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Update
      </Button>
      {state.status !== "idle" ? (
        <span role={state.status === "error" ? "alert" : "status"} className={cn("w-full text-right text-[11.5px]", state.status === "error" ? "text-rose" : "text-sage")}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
