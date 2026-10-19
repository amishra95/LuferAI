"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";

import { savePlatformGuardrailsAction } from "@/app/(dashboard)/agents/actions";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { DEFAULT_PLATFORM_GUARDRAILS, PLATFORM_BOUNDS, type PlatformGuardrails } from "@/lib/guardrails/platform";
import { cn, formatINR } from "@/lib/utils";

type Bounded = keyof typeof PLATFORM_BOUNDS;
type Nullable = "declineGapPct" | "escalateDiscountPct" | "escalateTotalInr";

const pct = (v: number) => `${v}%`;

function Slider({
  id,
  label,
  hint,
  value,
  onChange,
  format,
  disabled,
}: {
  id: Bounded;
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  disabled?: boolean;
}) {
  const b = PLATFORM_BOUNDS[id];
  return (
    <div className={cn("grid gap-1.5", disabled && "opacity-50")}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`gt-${id}`} className="text-fg text-[13px]">
          {label}
        </label>
        <output htmlFor={`gt-${id}`} className="text-fg font-mono text-[13px] tabular-nums">
          {format(value)}
        </output>
      </div>
      <input
        id={`gt-${id}`}
        type="range"
        min={b.min}
        max={b.max}
        step={b.step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-fg w-full"
        aria-valuetext={format(value)}
      />
      <span className="text-fg-subtle text-[12px] leading-5">{hint}</span>
    </div>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="text-fg block text-[13px]">{label}</span>
        <span className="text-fg-subtle block text-[12px] leading-5">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-fg mt-1 size-4 shrink-0" />
    </label>
  );
}

/**
 * Platform-wide ceilings for negotiation (lib/guardrails/platform.ts). Venue
 * hosts' own rules still apply within them. Saved to platform_guardrail_settings
 * and read by the RFP broadcast, counters, direct quotes and the AI negotiator.
 */
export function GuardrailTuning({ settings, ready, updatedAt }: { settings: PlatformGuardrails; ready: boolean; updatedAt: string | null }) {
  const [draft, setDraft] = useState(settings);
  // Last value of each optional threshold, so switching it back on restores it.
  const [remembered, setRemembered] = useState<Record<Nullable, number>>({
    declineGapPct: settings.declineGapPct ?? 50,
    escalateDiscountPct: settings.escalateDiscountPct ?? 15,
    escalateTotalInr: settings.escalateTotalInr ?? 500_000,
  });
  const save = useAction<PlatformGuardrails>();
  const set = <K extends keyof PlatformGuardrails>(key: K, value: PlatformGuardrails[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const toggle = (key: Nullable, on: boolean) => {
    if (!on && draft[key] !== null) setRemembered((r) => ({ ...r, [key]: draft[key]! }));
    set(key, on ? remembered[key] : null);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_PLATFORM_GUARDRAILS);

  if (!ready) {
    return (
      <p role="status" className="border-line text-fg-subtle rounded-lg border border-dashed px-4 py-4 text-[13px]">
        Guardrail tuning needs the Supabase database with migration 0028 (platform_guardrail_settings). The built-in limits apply until then: a {DEFAULT_PLATFORM_GUARDRAILS.maxDiscountPct}% discount
        cap, no escalation, and ±{DEFAULT_PLATFORM_GUARDRAILS.minSpendMaxChangePct}% per AI minimum-spend change.
      </p>
    );
  }

  const optional = (key: Nullable, label: string, hint: string, sliderLabel: string, format: (v: number) => string) => (
    <div className="border-line grid gap-3 rounded-lg border px-3.5 py-3">
      <Switch checked={draft[key] !== null} onChange={(on) => toggle(key, on)} label={label} hint={hint} />
      {draft[key] !== null ? <Slider id={key} label={sliderLabel} hint="" value={draft[key]!} onChange={(v) => set(key, v)} format={format} /> : null}
    </div>
  );

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run(() => savePlatformGuardrailsAction({ ...draft }), {
          failure: "Couldn't save the guardrails",
          success: () => ({ tone: "success", title: "Guardrails saved", description: "New offers, auto rules and negotiator changes use them within about 15 seconds." }),
        });
      }}
    >
      <fieldset className="grid gap-4">
        <legend className="label-mono mb-2">Discounts</legend>
        <Slider
          id="maxDiscountPct"
          label="Discount cap"
          hint="No counter, direct quote or automatic offer may go further below the venue's own price, whatever the host's own maximum."
          value={draft.maxDiscountPct}
          onChange={(v) => set("maxDiscountPct", v)}
          format={pct}
        />
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="label-mono mb-2">Automatic responses</legend>
        <Switch checked={draft.allowAutoCounter} onChange={(v) => set("allowAutoCounter", v)} label="Allow auto-counter" hint="Off: venues' auto-counter rules are paused and over-budget RFPs wait for the host." />
        <Switch checked={draft.allowAutoDecline} onChange={(v) => set("allowAutoDecline", v)} label="Allow auto-decline" hint="Off: venues' auto-decline rules are paused." />
        {draft.allowAutoDecline
          ? optional(
              "declineGapPct",
              "Auto-decline trigger: budget gap",
              "For venues with auto-decline on, also decline budgets this far under the venue's price, not only those below its floor.",
              "Decline when the budget is more than",
              (v) => `${v}% under`
            )
          : null}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="label-mono mb-2">Escalation thresholds</legend>
        <p className="text-fg-subtle -mt-1 text-[12px] leading-5">An automatic counter past either threshold isn&apos;t sent: the instant quote stands and the host decides. Shown as Escalated in the activity feed.</p>
        {optional("escalateDiscountPct", "Escalate deep discounts", "Automatic counters more than this far below the venue's price.", "Escalate beyond", (v) => `${v}% off`)}
        {optional("escalateTotalInr", "Escalate large deals", "Automatic counters whose pre-GST total is above this.", "Escalate above", (v) => formatINR(v))}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="label-mono mb-2">AI negotiator limits</legend>
        <Slider
          id="minSpendMaxChangePct"
          label="Minimum spend: largest change per approved call"
          hint="The host still approves every change; this bounds what the AI may propose in one step."
          value={draft.minSpendMaxChangePct}
          onChange={(v) => set("minSpendMaxChangePct", v)}
          format={(v) => `±${v}%`}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Slider id="packageMinPerHeadInr" label="Lowest package price" hint="Per head, for packages the AI creates or edits." value={draft.packageMinPerHeadInr} onChange={(v) => set("packageMinPerHeadInr", v)} format={(v) => formatINR(v)} />
          <Slider id="packageMaxPerHeadInr" label="Highest package price" hint="Must be above the lowest." value={draft.packageMaxPerHeadInr} onChange={(v) => set("packageMaxPerHeadInr", v)} format={(v) => formatINR(v)} />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        {updatedAt ? <span className="text-fg-faint text-[12px]">Last saved {new Date(updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn h-8 px-3 text-[12.5px]" disabled={isDefault || save.pending} onClick={() => setDraft(DEFAULT_PLATFORM_GUARDRAILS)}>
            <RotateCcw className="size-3.5" aria-hidden /> Defaults
          </button>
          <button type="button" className="btn h-8 px-3 text-[12.5px]" disabled={!dirty || save.pending} onClick={() => setDraft(settings)}>
            Discard
          </button>
          <button type="submit" className="btn btn-primary h-8 px-3 text-[12.5px]" disabled={!dirty || save.pending}>
            {save.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />} Save guardrails
          </button>
        </span>
      </div>
    </form>
  );
}
