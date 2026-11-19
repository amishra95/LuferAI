"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleSlash, UserCheck } from "lucide-react";

import { checkTrialBooking, type TrialBooking } from "@/lib/policies/approval-check";
import { EVENT_TYPES, type EventType } from "@/lib/policies/evaluate-booking-policy";
import { ENTERTAINMENT, type Entertainment, type PolicyRules } from "@/lib/policies/policy-rules";
import type { ApprovalRule } from "@/lib/services/enterprise/approvalEngine";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const inAWeek = () => new Date(Date.now() + 7 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * "Will this need approval?": a made-up booking checked against the rules as
 * they are in the form (saved or not), the spending bands and the chain.
 */
export function ApprovalChecker({
  companyId,
  rules,
  bands,
  chain,
  departments,
  committed,
}: {
  companyId: string;
  /** The form's rules; null while the form has an error. */
  rules: PolicyRules | null;
  bands: readonly ApprovalRule[];
  chain: readonly { tier: number; name: string }[];
  departments: readonly { id: string; name: string }[];
  committed: Readonly<Record<string, number>>;
}) {
  const [t, setT] = useState({ guests: "20", perHead: "2000", date: inAWeek(), startTime: "19:00", eventType: "team_meal" as EventType, alcohol: false, entertainment: [] as Entertainment[], distanceKm: "", departmentId: "" });
  const set = <K extends keyof typeof t>(k: K, v: (typeof t)[K]) => setT((s) => ({ ...s, [k]: v }));

  const trial: TrialBooking | null = useMemo(() => {
    const guests = Number(t.guests);
    const perHead = Number(t.perHead);
    if (!(guests > 0) || !(perHead > 0)) return null;
    return {
      guests,
      perHead,
      date: t.date,
      startTime: t.startTime,
      eventType: t.eventType,
      alcohol: t.alcohol,
      entertainment: t.entertainment,
      distanceKm: t.distanceKm === "" ? null : Number(t.distanceKm),
      departmentId: t.departmentId || null,
    };
  }, [t]);
  const verdict = rules && trial ? checkTrialBooking(companyId, rules, bands, chain, trial, committed) : null;

  return (
    <section className="panel p-5" aria-labelledby="checker-heading">
      <h3 id="checker-heading" className="label-mono mb-3">
        Will this need approval?
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Guests">
          <input type="number" inputMode="numeric" min={1} value={t.guests} onChange={(e) => set("guests", e.target.value)} className="field font-mono" />
        </Field>
        <Field label="Per guest (₹)">
          <input type="number" inputMode="numeric" min={1} value={t.perHead} onChange={(e) => set("perHead", e.target.value)} className="field font-mono" />
        </Field>
        <Field label="Date">
          <input type="date" value={t.date} onChange={(e) => set("date", e.target.value)} className="field font-mono" />
        </Field>
        <Field label="Starts">
          <input type="time" value={t.startTime} onChange={(e) => set("startTime", e.target.value)} className="field font-mono" />
        </Field>
        <Field label="Event">
          <select value={t.eventType} onChange={(e) => set("eventType", e.target.value as EventType)} className="field">
            {(Object.keys(EVENT_TYPES) as EventType[]).map((k) => (
              <option key={k} value={k}>
                {EVENT_TYPES[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From office (km)">
          <input type="number" inputMode="decimal" min={0} step={0.1} value={t.distanceKm} onChange={(e) => set("distanceKm", e.target.value)} placeholder="Unknown" className="field font-mono" />
        </Field>
        {departments.length > 0 ? (
          <Field label="Team" className="col-span-2">
            <select value={t.departmentId} onChange={(e) => set("departmentId", e.target.value)} className="field">
              <option value="">Any team</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="col-span-2 flex flex-wrap items-center gap-1.5">
          <label className="text-fg mr-2 flex items-center gap-2 text-meta">
            <input type="checkbox" checked={t.alcohol} onChange={(e) => set("alcohol", e.target.checked)} className="accent-fg size-4" />
            Alcohol
          </label>
          {(Object.keys(ENTERTAINMENT) as Entertainment[]).map((e) => {
            const on = t.entertainment.includes(e);
            return (
              <button
                key={e}
                type="button"
                aria-pressed={on}
                onClick={() => set("entertainment", on ? t.entertainment.filter((x) => x !== e) : [...t.entertainment, e])}
                className={cn("rounded-full border px-2.5 py-0.5 text-caption transition-colors", on ? "border-fg text-fg bg-surface-raised" : "border-line-strong text-fg-subtle hover:text-fg")}
              >
                {ENTERTAINMENT[e]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-line mt-4 border-t pt-4" aria-live="polite">
        {verdict === null ? (
          <p className="text-fg-subtle text-meta">{rules ? "Enter guests and a price per guest." : "Fix the rules above to check a booking."}</p>
        ) : verdict.kind === "instant" ? (
          <p className="text-sage flex items-center gap-2 text-body font-medium">
            <CircleCheck className="size-4 shrink-0" aria-hidden /> Books instantly · {inr(verdict.total)}
          </p>
        ) : verdict.kind === "blocked" ? (
          <div className="grid gap-1">
            <p className="text-rose flex items-center gap-2 text-body font-medium">
              <CircleSlash className="size-4 shrink-0" aria-hidden /> Can&apos;t be booked
            </p>
            <p className="text-fg-muted text-meta">{capital(verdict.reason)}.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-warn flex items-center gap-2 text-body font-medium">
              <UserCheck className="size-4 shrink-0" aria-hidden /> {verdict.levels === 1 ? "Needs one approval" : `Needs ${verdict.levels} approvals`} · {inr(verdict.total)}
            </p>
            <ol className="grid gap-0.5 text-meta">
              {verdict.approvers.map((a) => (
                <li key={a.level} className="text-fg">
                  <span className="text-fg-subtle font-mono">{a.level}.</span> {a.name ?? <span className="text-warn">No approver at level {a.level}</span>}
                </li>
              ))}
            </ol>
            <ul className="text-fg-muted grid gap-1 text-meta">
              {verdict.reasons.flatMap((r) => r.split("; ")).map((r) => (
                <li key={r}>{capital(r)}.</li>
              ))}
            </ul>
            {verdict.chainShort ? <p className="text-warn text-meta">Add approvers on the Approvals tab, or this booking can&apos;t be sent.</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1", className)}>
      <span className="text-fg-subtle text-caption">{label}</span>
      {children}
    </label>
  );
}
