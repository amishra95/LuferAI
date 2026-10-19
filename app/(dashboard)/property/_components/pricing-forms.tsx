"use client";

import { useActionState, useState } from "react";
import { CalendarPlus, Loader2, Lock, Pencil, Plus, Save, X } from "lucide-react";

import { addRateMultiplierAction, saveMinimumSpendAction, savePackageAction, saveTermsAction } from "../actions";
import { Feedback, IDLE } from "./host-forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DIETARY_TAGS, dietaryLabel } from "@/lib/quotes";
import { MULTIPLIER_KIND_LABEL, MULTIPLIER_KINDS, PRICING_LIMITS, WEEKDAY_LABEL, type GuestTier, type MultiplierKind } from "@/lib/rates/venue-pricing";
import { cn, formatINR } from "@/lib/utils";
import type { CancellationTier } from "@/lib/venues/profile";

const MIGRATION_NOTE = "Needs database migration 0027 (venue_pricing_rules).";

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} {children}
    </Button>
  );
}

function Money({ name, label, hint, defaultValue }: { name: string; label: string; hint: string; defaultValue: number }) {
  return (
    <label className="grid gap-1.5">
      <span className="label-mono">{label}</span>
      <span className="relative">
        <span className="text-fg-subtle pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px]" aria-hidden>
          ₹
        </span>
        <Input name={name} inputMode="numeric" defaultValue={defaultValue || ""} placeholder="0" className="pl-7 font-mono" />
      </span>
      <span className="text-fg-subtle text-[12px]">{hint}</span>
    </label>
  );
}

function LockToggle({ name, defaultChecked, disabled, children }: { name: string; defaultChecked: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2.5 text-[12.5px]", disabled ? "text-fg-faint" : "cursor-pointer")}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="accent-fg mt-0.5 size-3.5" />
      <span>
        <Lock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
        {children}
      </span>
    </label>
  );
}

/**
 * Repeatable rows (tiers, cancellation rules) as controlled strings: React resets
 * a form after its action runs, which would blank rows added since the page loaded.
 */
let rowSeq = 0;
function useRows<F extends string>(initial: Record<F, string>[]) {
  const [rows, setRows] = useState(() => initial.map((values) => ({ key: ++rowSeq, values })));
  return {
    rows,
    add: (values: Record<F, string>) => setRows((r) => [...r, { key: ++rowSeq, values }]),
    remove: (key: number) => setRows((r) => r.filter((x) => x.key !== key)),
    set: (key: number, field: F, value: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, values: { ...x.values, [field]: value } } : x))),
  };
}

const str = (n: number | null | undefined) => (n == null ? "" : String(n));

// ----------------------------------------------------------------------------
// Minimum spend + guest-count tiers
// ----------------------------------------------------------------------------

export function MinimumSpendForm({
  venueId,
  minSpend,
  minPerHead,
  tiers,
  lockMinSpend,
  ready,
}: {
  venueId: string;
  minSpend: number;
  minPerHead: number;
  tiers: GuestTier[];
  lockMinSpend: boolean;
  /** venue_pricing_rules exists (tiers and the lock can be saved). */
  ready: boolean;
}) {
  const [state, action, pending] = useActionState(saveMinimumSpendAction, IDLE);
  const tierRows = useRows(tiers.map((t) => ({ min: str(t.min_guests), max: str(t.max_guests), pct: str(t.adjustment_pct) })));
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="venue_id" value={venueId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Money name="min_spend_inr" label="Minimum spend" defaultValue={minSpend} hint="Pre-GST total every quote is lifted to." />
        <Money name="min_spend_per_head_inr" label="Minimum per guest" defaultValue={minPerHead} hint="Booking requests below this per head are refused. Blank or 0 for none." />
      </div>

      <fieldset className="grid gap-2" disabled={!ready}>
        <legend className="label-mono mb-1">Guest-count tiers</legend>
        <p className="text-fg-subtle text-[12.5px] leading-5">
          Adjust every package&apos;s per-head price by party size: −5 is 5% off for that band, 10 is 10% more. Party sizes outside every band pay the package price.
          {ready ? null : ` ${MIGRATION_NOTE}`}
        </p>
        {tierRows.rows.length > 0 ? (
          <div className="grid gap-2">
            <div className="text-fg-subtle hidden grid-cols-[1fr_1fr_1fr_2rem] gap-2 text-[11.5px] sm:grid" aria-hidden>
              <span>From guests</span>
              <span>To guests (blank = no limit)</span>
              <span>Per-head adjustment %</span>
            </div>
            {tierRows.rows.map(({ key, values }, i) => (
              <div key={key} className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-2">
                <Input name="tier_min" type="number" min={1} step={1} value={values.min} onChange={(e) => tierRows.set(key, "min", e.target.value)} aria-label={`Tier ${i + 1}: from guests`} placeholder="41" />
                <Input name="tier_max" type="number" min={1} step={1} value={values.max} onChange={(e) => tierRows.set(key, "max", e.target.value)} aria-label={`Tier ${i + 1}: to guests`} placeholder="100" />
                <Input
                  name="tier_pct"
                  type="number"
                  min={PRICING_LIMITS.minAdjustmentPct}
                  max={PRICING_LIMITS.maxAdjustmentPct}
                  step="any"
                  value={values.pct}
                  onChange={(e) => tierRows.set(key, "pct", e.target.value)}
                  aria-label={`Tier ${i + 1}: per-head adjustment percent`}
                  placeholder="-5"
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove tier ${i + 1}`} onClick={() => tierRows.remove(key)}>
                  <X aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {tierRows.rows.length < PRICING_LIMITS.maxTiers ? (
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => tierRows.add({ min: "", max: "", pct: "" })}>
            <Plus aria-hidden /> Add tier
          </Button>
        ) : null}
      </fieldset>

      <LockToggle name="lock_min_spend" defaultChecked={lockMinSpend} disabled={!ready}>
        Lock the minimum spend: the AI negotiator can suggest a change but not make it.
      </LockToggle>

      <Feedback state={state} />
      <div className="flex justify-end">
        <SubmitButton pending={pending}>Save minimums</SubmitButton>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------------------
// Menu packages
// ----------------------------------------------------------------------------

export interface EditablePackage {
  id: string;
  name: string;
  per_head_inr: number;
  dietary_tags: string[];
  description: string | null;
  is_active: boolean;
}

/** One package: a summary row that opens into its editor. `pkg` null = the "Add package" row. */
export function PackageEditor({ venueId, pkg, locked, ready }: { venueId: string; pkg: EditablePackage | null; locked: boolean; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(savePackageAction, IDLE);

  if (!open) {
    if (!pkg) {
      return (
        <div className="flex flex-col items-start gap-1.5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus aria-hidden /> Add package
          </Button>
          <Feedback state={state} />
        </div>
      );
    }
    return (
      <div className="grid gap-1 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn("font-medium", !pkg.is_active && "text-fg-subtle")}>{pkg.name}</span>
          <span className="font-mono text-[12.5px] tabular-nums">{formatINR(pkg.per_head_inr)}/head</span>
          {!pkg.is_active ? <span className="text-fg-faint text-[12px]">inactive</span> : null}
          {locked ? (
            <span className="text-fg-subtle inline-flex items-center gap-1 text-[12px]" title="The AI negotiator can't change this package">
              <Lock className="size-3" aria-hidden /> locked
            </span>
          ) : null}
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(true)} aria-label={`Edit ${pkg.name}`}>
            <Pencil aria-hidden /> Edit
          </Button>
        </div>
        <p className="text-fg-subtle text-[12.5px]">
          {pkg.dietary_tags.length ? `Covers ${pkg.dietary_tags.map(dietaryLabel).join(", ")}` : "No dietary coverage listed"}
          {pkg.description ? ` · ${pkg.description}` : ""}
        </p>
        <Feedback state={state} />
      </div>
    );
  }

  return (
    <form action={action} className="border-line bg-surface my-3 grid gap-3 rounded-lg border p-4 sm:grid-cols-[2fr_1fr]">
      <input type="hidden" name="venue_id" value={venueId} />
      {pkg ? <input type="hidden" name="package_id" value={pkg.id} /> : null}
      <label className="grid gap-1 text-[12.5px]">
        <span className="text-fg-subtle">Name</span>
        <Input name="name" required maxLength={80} defaultValue={pkg?.name} placeholder="e.g. Coastal set menu" autoFocus />
      </label>
      <label className="grid gap-1 text-[12.5px]">
        <span className="text-fg-subtle">Per head (₹, pre-GST)</span>
        <Input name="per_head_inr" type="number" required min={100} max={50000} step="any" defaultValue={pkg?.per_head_inr} />
      </label>
      <fieldset className="grid gap-1.5 sm:col-span-2">
        <legend className="text-fg-subtle mb-1 text-[12.5px]">Covers every guest who is…</legend>
        <div className="flex flex-wrap gap-2">
          {DIETARY_TAGS.map((tag) => (
            <label key={tag} className="border-line has-checked:border-fg/40 has-checked:bg-fg/[0.04] inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px]">
              <input type="checkbox" name="dietary_tags" value={tag} defaultChecked={pkg?.dietary_tags.includes(tag)} className="accent-fg size-3" />
              {dietaryLabel(tag)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1 text-[12.5px] sm:col-span-2">
        <span className="text-fg-subtle">Description (optional)</span>
        <Input name="description" maxLength={280} defaultValue={pkg?.description ?? ""} placeholder="Courses, drinks, what's included" />
      </label>
      <div className="grid gap-2 sm:col-span-2">
        <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px]">
          <input type="checkbox" name="is_active" defaultChecked={pkg?.is_active ?? true} className="accent-fg size-3.5" />
          Active: offered in new quotes
        </label>
        <LockToggle name="locked" defaultChecked={locked} disabled={!ready}>
          Lock against AI changes{ready ? "" : ` (${MIGRATION_NOTE})`}
        </LockToggle>
      </div>
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {state.status === "success" ? "Done" : "Cancel"}
        </Button>
        <SubmitButton pending={pending}>{pkg ? "Save package" : "Add package"}</SubmitButton>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------------------
// Deposit + cancellation
// ----------------------------------------------------------------------------

export function TermsForm({
  venueId,
  depositPct,
  defaultDepositPct,
  cancellation,
  ready,
}: {
  venueId: string;
  depositPct: number | null;
  defaultDepositPct: number;
  cancellation: CancellationTier[];
  ready: boolean;
}) {
  const [state, action, pending] = useActionState(saveTermsAction, IDLE);
  const cancelRows = useRows(cancellation.map((t) => ({ days: str(t.days_before), pct: str(t.refund_pct) })));
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="venue_id" value={venueId} />
      <label className="grid gap-1.5">
        <span className="label-mono">Deposit</span>
        <span className="relative max-w-40">
          <Input name="deposit_pct" inputMode="decimal" defaultValue={depositPct ?? ""} placeholder={String(defaultDepositPct)} disabled={!ready} className="pr-7 font-mono" />
          <span className="text-fg-subtle pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px]" aria-hidden>
            %
          </span>
        </span>
        <span className="text-fg-subtle text-[12px]">
          Of the GST-inclusive total, authorised when the client books and captured when you confirm. Blank for the platform&apos;s {defaultDepositPct}%.
          {ready ? "" : ` ${MIGRATION_NOTE}`}
        </span>
      </label>

      <fieldset className="grid gap-2">
        <legend className="label-mono mb-1">Cancellation refunds</legend>
        <p className="text-fg-subtle text-[12.5px] leading-5">
          Cancelling at least this many days before the event refunds this share. More notice may not refund less. No rules: clients see &ldquo;terms on request&rdquo;.
        </p>
        {cancelRows.rows.map(({ key, values }, i) => (
          <div key={key} className="grid grid-cols-[1fr_1fr_2rem] items-center gap-2">
            <label className="relative">
              <Input name="cancel_days" type="number" min={0} max={365} step={1} value={values.days} onChange={(e) => cancelRows.set(key, "days", e.target.value)} aria-label={`Rule ${i + 1}: days before the event`} placeholder="14" className="pr-24" />
              <span className="text-fg-subtle pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px]" aria-hidden>
                days before
              </span>
            </label>
            <label className="relative">
              <Input name="cancel_pct" type="number" min={0} max={100} step="any" value={values.pct} onChange={(e) => cancelRows.set(key, "pct", e.target.value)} aria-label={`Rule ${i + 1}: refund percent`} placeholder="100" className="pr-20" />
              <span className="text-fg-subtle pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px]" aria-hidden>
                % refund
              </span>
            </label>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove rule ${i + 1}`} onClick={() => cancelRows.remove(key)}>
              <X aria-hidden />
            </Button>
          </div>
        ))}
        {cancelRows.rows.length < PRICING_LIMITS.maxCancellationTiers ? (
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => cancelRows.add({ days: "", pct: "" })}>
            <Plus aria-hidden /> Add rule
          </Button>
        ) : null}
      </fieldset>

      <Feedback state={state} />
      <div className="flex justify-end">
        <SubmitButton pending={pending}>Save terms</SubmitButton>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------------------
// Rate calendar
// ----------------------------------------------------------------------------

export function AddRateForm({ venueId, today, disabledReason }: { venueId: string; today: string; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MultiplierKind>("weekend");
  const [state, action, pending] = useActionState(addRateMultiplierAction, IDLE);

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button type="button" onClick={() => setOpen(true)} disabled={Boolean(disabledReason)} title={disabledReason}>
          <CalendarPlus aria-hidden /> Add rate
        </Button>
        {disabledReason ? <span className="text-fg-subtle text-[12px]">{disabledReason}</span> : <Feedback state={state} />}
      </div>
    );
  }
  return (
    <form action={action} className="border-line bg-surface grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
      <input type="hidden" name="venue_id" value={venueId} />
      <label className="grid gap-1 text-[12.5px]">
        <span className="text-fg-subtle">Kind</span>
        <NativeSelect name="kind" value={kind} onChange={(e) => setKind(e.target.value as MultiplierKind)}>
          {MULTIPLIER_KINDS.map((k) => (
            <option key={k} value={k}>
              {MULTIPLIER_KIND_LABEL[k]}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1 text-[12.5px]">
        <span className="text-fg-subtle">Label (optional)</span>
        <Input name="label" maxLength={60} placeholder={kind === "weekend" ? "Weekend surcharge" : kind === "peak_season" ? "Wedding season" : "New Year's Eve"} />
      </label>
      {kind === "weekend" ? (
        <fieldset className="grid gap-1.5 sm:col-span-2">
          <legend className="text-fg-subtle mb-1 text-[12.5px]">Applies on</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABEL.map((label, day) => (
              <label key={label} className="border-line has-checked:border-fg/40 has-checked:bg-fg/[0.04] inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px]">
                <input type="checkbox" name="weekdays" value={day} defaultChecked={day === 5 || day === 6} className="accent-fg size-3" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <>
          <label className="grid gap-1 text-[12.5px]">
            <span className="text-fg-subtle">From</span>
            <Input name="starts_on" type="date" min={today} required />
          </label>
          <label className="grid gap-1 text-[12.5px]">
            <span className="text-fg-subtle">To (blank = one day)</span>
            <Input name="ends_on" type="date" min={today} />
          </label>
        </>
      )}
      <label className="grid gap-1 text-[12.5px]">
        <span className="text-fg-subtle">Multiplier</span>
        <span className="relative max-w-40">
          <span className="text-fg-subtle pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px]" aria-hidden>
            ×
          </span>
          <Input
            name="multiplier"
            type="number"
            required
            min={PRICING_LIMITS.minMultiplier}
            max={PRICING_LIMITS.maxMultiplier}
            step="0.01"
            defaultValue={kind === "weekend" ? 1.15 : kind === "peak_season" ? 1.25 : 1.5}
            className="pl-7 font-mono"
          />
        </span>
      </label>
      <p className="text-fg-subtle self-end text-[12px]">×1.2 is 20% more on every package that day. When several apply, the largest wins; they don&apos;t stack.</p>
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {state.status === "success" ? "Done" : "Cancel"}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarPlus aria-hidden />} Add to calendar
        </Button>
      </div>
    </form>
  );
}
