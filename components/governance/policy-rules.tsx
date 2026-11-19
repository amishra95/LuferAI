"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { policyRulesAction } from "@/app/(dashboard)/governance/actions";
import { ApprovalChecker } from "@/components/governance/approval-checker";
import { segmentClass } from "@/components/portal/segment";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { EVENT_TYPES, type EventType } from "@/lib/policies/evaluate-booking-policy";
import {
  ALCOHOL_CHOICES,
  ENTERTAINMENT,
  matchingPreset,
  PolicyRulesInput,
  PRESETS,
  summarizeRules,
  type AlcoholChoice,
  type Entertainment,
  type PolicyRules,
  type PresetKey,
} from "@/lib/policies/policy-rules";
import { cn } from "@/lib/utils";

type MoneyKey = "autoPerHead" | "managerPerHead" | "maxPerHead" | "approvalAbove" | "seniorAbove" | "monthlyLimit";

/** What the inputs hold: numbers as typed text, so a half-typed value isn't lost. */
type Form = Omit<PolicyRules, MoneyKey | "maxDistanceKm" | "hoursStart" | "hoursEnd"> & Record<MoneyKey | "maxDistanceKm" | "hoursStart" | "hoursEnd", string>;

const text = (n: number | string | null) => (n == null || n === 0 ? "" : String(n));
const toForm = (r: PolicyRules): Form => ({
  ...r,
  autoPerHead: text(r.autoPerHead),
  managerPerHead: text(r.managerPerHead),
  maxPerHead: text(r.maxPerHead),
  approvalAbove: text(r.approvalAbove),
  seniorAbove: text(r.seniorAbove),
  monthlyLimit: text(r.monthlyLimit),
  maxDistanceKm: text(r.maxDistanceKm),
  hoursStart: r.hoursStart ?? "",
  hoursEnd: r.hoursEnd ?? "",
});

/**
 * Policies → Rules: every rule the booking check enforces, as sentences with
 * the numbers in them, a preset to start from, and the rules read back in
 * plain words. Blank = no limit.
 */
export function PolicyRulesEditor({
  companyId,
  initial,
  canManage,
  checker,
}: {
  companyId: string | null;
  initial: PolicyRules;
  canManage: boolean;
  /** What the "Will this need approval?" checker needs besides the rules. */
  checker: Omit<React.ComponentProps<typeof ApprovalChecker>, "rules">;
}) {
  const [saved, setSaved] = useState(() => toForm(initial));
  const [form, setForm] = useState(saved);
  const act = useAction<{ ok: true }>();

  // Parsed live: the summary and the preset follow what's typed; errors show on Save.
  const parsed = useMemo(() => PolicyRulesInput.safeParse(form), [form]);
  const summary = parsed.success ? summarizeRules(parsed.data) : null;
  const preset = parsed.success ? matchingPreset(parsed.data) : null;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = <T extends string>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const outcome = await act.run(() => policyRulesAction(companyId, form), {
      failure: "Couldn't save the rules",
      success: () => ({ tone: "success", title: "Rules saved" }),
    });
    if (outcome?.ok) setSaved(form);
  };

  const money = (key: MoneyKey, label: string) => (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className="text-fg text-body">{label}</span>
      <span className="relative w-36 shrink-0">
        <span className="text-fg-subtle pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-meta">₹</span>
        <input type="number" inputMode="numeric" min={1} step={1} value={form[key]} onChange={(e) => set(key, e.target.value)} disabled={!canManage} placeholder="No limit" className="field pl-7 text-right font-mono" />
      </span>
    </label>
  );

  const alcohol = (key: "alcohol" | "weekdayAlcohol", label: string, disabled = false) => (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className={cn("text-body", disabled ? "text-fg-subtle" : "text-fg")}>{label}</span>
      <select value={disabled ? "prohibited" : form[key]} onChange={(e) => set(key, e.target.value as AlcoholChoice)} disabled={!canManage || disabled} className="field w-40 shrink-0">
        {(Object.keys(ALCOHOL_CHOICES) as AlcoholChoice[]).map((c) => (
          <option key={c} value={c}>
            {ALCOHOL_CHOICES[c]}
          </option>
        ))}
      </select>
    </label>
  );

  const chips = <T extends string>(label: string, items: Record<T, string>, chosen: T[], onToggle: (item: T) => void) => (
    <div className="flex flex-wrap items-center gap-1.5 py-3" role="group" aria-label={label}>
      <span className="text-fg w-full text-body sm:w-28">{label}</span>
      {(Object.keys(items) as T[]).map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={chosen.includes(item)}
          disabled={!canManage}
          onClick={() => onToggle(item)}
          className={cn(segmentClass(chosen.includes(item)), "border-line-strong border", chosen.includes(item) && "border-fg")}
        >
          {items[item]}
        </button>
      ))}
    </div>
  );

  return (
    <form onSubmit={save} className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <div className="grid gap-6">
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Start from a preset">
            <span className="text-fg-subtle text-meta mr-1">Start from</span>
            {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
              <button key={key} type="button" aria-pressed={preset === key} onClick={() => setForm(toForm(PRESETS[key].rules))} className={cn(segmentClass(preset === key), "border-line-strong border")}>
                {PRESETS[key].label}
              </button>
            ))}
            {preset === null && summary?.length ? <span className="text-fg-subtle text-meta ml-1">Custom</span> : null}
          </div>
        ) : null}

        <Group title="Per guest, before GST">
          {money("autoPerHead", "Books instantly up to")}
          {money("managerPerHead", "A manager approves up to")}
          {money("maxPerHead", "Always needs approval above")}
        </Group>

        <Group title="Per booking, before GST">
          {money("approvalAbove", "Needs approval above")}
          {money("seniorAbove", "Needs senior approval above")}
          {money("monthlyLimit", "Monthly spend limit")}
        </Group>

        <Group title="Alcohol">
          {alcohol("alcohol", "Alcohol")}
          {alcohol("weekdayAlcohol", "On weekdays (Mon–Fri)", form.alcohol === "prohibited")}
        </Group>

        <Group title="When and where">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
            <span className="text-fg text-body">Events start between</span>
            <span className="flex items-center gap-2">
              <input type="time" value={form.hoursStart} onChange={(e) => set("hoursStart", e.target.value)} disabled={!canManage} aria-label="Earliest start" className="field w-32 font-mono" />
              <span className="text-fg-subtle text-meta">and</span>
              <input type="time" value={form.hoursEnd} onChange={(e) => set("hoursEnd", e.target.value)} disabled={!canManage} aria-label="Latest start" className="field w-32 font-mono" />
            </span>
          </div>
          <label className="flex items-center justify-between gap-4 py-2">
            <span className="text-fg text-body">Within this distance of the office</span>
            <span className="relative w-36 shrink-0">
              <input type="number" inputMode="decimal" min={0.1} step={0.1} value={form.maxDistanceKm} onChange={(e) => set("maxDistanceKm", e.target.value)} disabled={!canManage} placeholder="No limit" className="field pr-10 text-right font-mono" />
              <span className="text-fg-subtle pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-meta">km</span>
            </span>
          </label>
        </Group>

        <Group title="Always needs approval">
          {chips<Entertainment>("Entertainment", ENTERTAINMENT, form.entertainment, (e) => set("entertainment", toggle(form.entertainment, e)))}
          {chips<EventType>("Event types", EVENT_TYPES, form.eventTypes, (t) => set("eventTypes", toggle(form.eventTypes, t)))}
        </Group>

        {canManage ? (
          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={act.pending || !dirty}>
              {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              Save rules
            </button>
            {dirty ? (
              <button type="button" className="btn btn-ghost" onClick={() => setForm(saved)} disabled={act.pending}>
                Discard changes
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:sticky lg:top-6">
      <aside className="panel p-5" aria-labelledby="rules-summary-heading" aria-live="polite">
        <h3 id="rules-summary-heading" className="label-mono mb-3">
          {dirty ? "Your rules, after saving" : "Your rules"}
        </h3>
        {summary === null ? (
          <p className="text-warn text-meta">{parsed.success ? null : parsed.error.issues[0]?.message}</p>
        ) : summary.length === 0 ? (
          <p className="text-fg text-body">Anything can be booked without approval.</p>
        ) : (
          <ul className="grid gap-2.5">
            {summary.map((line) => (
              <li key={line} className="text-fg flex gap-2.5 text-body">
                <span className="bg-accent mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        )}
      </aside>
      <ApprovalChecker {...checker} rules={parsed.success ? parsed.data : null} />
      </div>
    </form>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="panel px-5 pt-4 pb-2">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="label-mono mb-1">
        {title}
      </p>
      <div className="divide-line divide-y">{children}</div>
    </fieldset>
  );
}
