"use client";

import { useState } from "react";
import { CheckCircle2, Clock, Loader2, Plus, ShieldCheck, Trash2, UtensilsCrossed } from "lucide-react";

import { approvePlanAction, savePlanAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { MAX_ITEM_LENGTH, MAX_REQUIREMENTS, MAX_RUN_OF_SHOW, planStatus, signOffBlocker, validatePlan, type EventPlan, type RunOfShowItem } from "@/lib/events/plan";
import { cn, formatINR } from "@/lib/utils";
import { useRoom } from "./event-room";

export interface PlanPackage {
  id: string;
  name: string;
  per_head_inr: number;
  dietary_tags: string[];
}

const STAGE_VARIANT = { empty: "outline", draft: "warning", changed: "warning", approved: "success" } as const;

const STAMP = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/** The plan's sign-off state as a badge, with who/when. */
export function PlanStatusBadge({ plan }: { plan: EventPlan }) {
  const s = planStatus(plan);
  return <Badge variant={STAGE_VARIANT[s.stage]}>{s.label}</Badge>;
}

/**
 * "Approve event plan": for Approvers, the plan revision on screen. Others see
 * the button disabled with why. Refused if the plan changed meanwhile.
 */
export function SignOffButton({ bookingId, plan, role, readOnlyReason }: { bookingId: string; plan: EventPlan; role: string | null; readOnlyReason?: string }) {
  const { run, pending } = useAction<EventPlan>();
  const { record } = useRoom();
  const blocked = readOnlyReason ?? signOffBlocker(role, plan);
  if (planStatus(plan).stage === "approved") return null;
  if (blocked) {
    return (
      <span title={blocked} className="inline-flex cursor-not-allowed flex-col items-start gap-1">
        <Button type="button" disabled className="pointer-events-none">
          <ShieldCheck aria-hidden /> Approve event plan
        </Button>
        <span className="text-fg-subtle text-caption">{blocked}</span>
      </span>
    );
  }
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={async () => {
        const outcome = await run(() => approvePlanAction(bookingId, plan.revision), {
          failure: "Couldn't sign off the plan",
          success: () => ({ tone: "success", title: "Event plan signed off", description: "The venue sees it on their event brief." }),
        });
        if (outcome?.ok) record("schedule", "signed off the event plan");
      }}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />} Approve event plan
    </Button>
  );
}

/**
 * Run of show, catering and special requirements. Editable by Organizers and
 * Approvers while the event can change; a saved change after sign-off needs a
 * fresh sign-off. The form resets when a teammate's save lands (keyed by revision).
 */
export function EventPlanEditor({ bookingId, plan, packages, readOnly, ready }: { bookingId: string; plan: EventPlan; packages: PlanPackage[]; readOnly: boolean; ready: boolean }) {
  const pkg = packages.find((p) => p.id === plan.cateringPackageId) ?? null;
  if (!ready) {
    return (
      <p role="status" className="border-line text-fg-subtle rounded-lg border border-dashed px-4 py-4 text-meta">
        Event plans need database migration 0026. Ask an admin to apply it; the schedule and guest list work meanwhile.
      </p>
    );
  }
  if (readOnly) return <PlanView plan={plan} pkg={pkg} />;
  return <PlanForm key={plan.revision} bookingId={bookingId} plan={plan} packages={packages} />;
}

function PlanView({ plan, pkg }: { plan: EventPlan; pkg: PlanPackage | null }) {
  if (!plan.runOfShow.length && !pkg && !plan.specialRequirements) return <p className="text-fg-subtle text-meta">No run of show, catering or requirements yet.</p>;
  return (
    <div className="grid gap-5">
      <RunOfShowList items={plan.runOfShow} />
      <div className="grid gap-1">
        <span className="label-mono">Catering</span>
        <p className="text-meta">{pkg ? `${pkg.name} · ${formatINR(pkg.per_head_inr)} a head` : "Not chosen"}</p>
      </div>
      {plan.specialRequirements ? (
        <div className="grid gap-1">
          <span className="label-mono">Special requirements</span>
          <p className="text-meta whitespace-pre-wrap">{plan.specialRequirements}</p>
        </div>
      ) : null}
    </div>
  );
}

function RunOfShowList({ items }: { items: RunOfShowItem[] }) {
  if (!items.length) return <p className="text-fg-subtle text-meta">No run of show yet.</p>;
  return (
    <ol className="grid gap-2" aria-label="Run of show">
      {items.map((i, n) => (
        <li key={n} className="flex gap-3 text-meta">
          <span className="text-fg-subtle w-12 shrink-0 font-mono tabular-nums">{i.time}</span>
          <span className="text-fg">{i.item}</span>
        </li>
      ))}
    </ol>
  );
}

function PlanForm({ bookingId, plan, packages }: { bookingId: string; plan: EventPlan; packages: PlanPackage[] }) {
  const [rows, setRows] = useState<RunOfShowItem[]>(plan.runOfShow.length ? plan.runOfShow : [{ time: "", item: "" }]);
  const [cateringPackageId, setPackage] = useState(plan.cateringPackageId ?? "");
  const [specialRequirements, setRequirements] = useState(plan.specialRequirements);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction<EventPlan>();
  const { record } = useRoom();
  const signedOff = planStatus(plan).stage === "approved";

  async function save() {
    const input = { runOfShow: rows, cateringPackageId: cateringPackageId || null, specialRequirements };
    const valid = validatePlan(input);
    if (!valid.ok) return setError(valid.error);
    setError(null);
    const outcome = await run(() => savePlanAction(bookingId, valid.value), {
      failure: "Couldn't save the plan",
      success: (saved) => ({
        tone: "success",
        title: "Plan saved",
        description: signedOff && saved.revision !== plan.revision ? "It changed after sign-off, so it needs a fresh one." : undefined,
      }),
    });
    if (outcome?.ok && outcome.result.revision !== plan.revision) record("schedule", "updated the event plan");
  }

  const chosen = packages.find((p) => p.id === cateringPackageId);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="grid gap-6"
    >
      <fieldset className="grid gap-2">
        <legend className="label-mono mb-1 flex items-center gap-1.5">
          <Clock className="size-3.5" aria-hidden /> Run of show
        </legend>
        <ol className="grid gap-2">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[8.75rem_minmax(0,1fr)_auto] items-center gap-2">
              <Input type="time" aria-label={`Row ${i + 1} time`} value={r.time} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} className="font-mono" />
              <Input
                aria-label={`Row ${i + 1} item`}
                value={r.item}
                maxLength={MAX_ITEM_LENGTH}
                placeholder={i === 0 ? "Guests arrive, welcome drinks" : "What happens"}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ time: "", item: "" }])}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        <div>
          <Button type="button" variant="ghost" size="sm" disabled={rows.length >= MAX_RUN_OF_SHOW} onClick={() => setRows([...rows, { time: "", item: "" }])}>
            <Plus aria-hidden /> Add item
          </Button>
        </div>
      </fieldset>

      <label className="grid gap-1.5">
        <span className="label-mono flex items-center gap-1.5">
          <UtensilsCrossed className="size-3.5" aria-hidden /> Catering package
        </span>
        {packages.length ? (
          <NativeSelect value={cateringPackageId} onChange={(e) => setPackage(e.target.value)}>
            <option value="">Not chosen yet</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatINR(p.per_head_inr)} a head
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span className="text-fg-subtle text-meta">The venue hasn&apos;t listed menu packages; note your catering needs below.</span>
        )}
        {chosen?.dietary_tags.length ? <span className="text-fg-subtle text-caption">Covers: {chosen.dietary_tags.join(", ").replace(/_/g, " ")}</span> : null}
      </label>

      <label className="grid gap-1.5">
        <span className="label-mono">Special requirements</span>
        <textarea
          value={specialRequirements}
          onChange={(e) => setRequirements(e.target.value)}
          rows={4}
          maxLength={MAX_REQUIREMENTS}
          placeholder="AV, stage, accessibility, seating, timings the venue should know…"
          className="field h-auto resize-y py-2 text-meta leading-5"
        />
      </label>

      {error && (
        <p role="alert" className="text-rose text-meta">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {signedOff ? <span className="text-fg-subtle text-caption">Saving changes means it needs a fresh sign-off.</span> : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />} Save plan
        </Button>
      </div>
    </form>
  );
}

/** Who signed off and whether the venue has it, under the status badge. */
export function SignOffTrail({ plan, approverName }: { plan: EventPlan; approverName: string | null }) {
  const s = planStatus(plan);
  return (
    <p className={cn("text-meta", s.stage === "changed" ? "text-warn" : "text-fg-subtle")}>
      {s.stage === "approved"
        ? `Signed off by ${approverName ?? "an Approver"}${plan.approvedAt ? ` on ${STAMP.format(new Date(plan.approvedAt))}` : ""}. ${s.venueAcknowledged ? `The venue confirmed it${plan.venueAckAt ? ` on ${STAMP.format(new Date(plan.venueAckAt))}` : ""}.` : "Waiting for the venue to confirm."}`
        : s.stage === "changed"
          ? "Edited after sign-off: an Approver needs to sign off the new version before the venue sees it."
          : s.stage === "draft"
            ? "An Approver signs off the plan; the venue then confirms it on their event brief."
            : "Add the run of show, catering and requirements, then an Approver signs off."}
    </p>
  );
}
