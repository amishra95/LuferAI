"use client";

import { useState } from "react";
import { Loader2, Trash2, Wallet } from "lucide-react";

import { budgetCommandAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { BudgetMeter } from "@/components/portal/budget-meter";
import { EmptyState } from "@/components/portal/empty-state";
import { Pill } from "@/components/portal/pills";
import { NativeSelect } from "@/components/ui/native-select";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { periodLabel, type BudgetEnforcement, type BudgetPeriod } from "@/lib/services/enterprise/budgetService";
import type { BudgetView } from "@/lib/services/enterprise/governanceStore";
import { cn, formatINR } from "@/lib/utils";

/**
 * Team budgets (team_budgets / budget_holds): each department's monthly or FY
 * quarterly limit and what's drawn against it. Requests awaiting approval hold
 * their amount; approval commits it; the event consumes it; cancelling releases it.
 */
export function BudgetManager({
  companyId,
  budgets,
  departments,
  canManage,
  today,
}: {
  companyId: string | null;
  budgets: BudgetView[];
  departments: { id: string; name: string }[];
  canManage: boolean;
  today: string;
}) {
  const [form, setForm] = useState({ departmentId: departments[0]?.id ?? "", period: "quarterly" as BudgetPeriod, month: today.slice(0, 7), limit: "", enforcement: "approval" as BudgetEnforcement });
  const save = useAction<unknown>();
  const remove = useAction<unknown>();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Current and upcoming periods first, then past ones.
  const sorted = [...budgets].sort((a, b) => Number(a.period_end < today) - Number(b.period_end < today) || a.period_start.localeCompare(b.period_start) || a.departmentName.localeCompare(b.departmentName));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const outcome = await save.run(() => budgetCommandAction(companyId, { action: "save", ...form }), {
      failure: "Couldn't save the budget",
      success: () => ({ tone: "success", title: "Budget saved", description: "New requests from the team are checked against it." }),
    });
    if (outcome?.ok) setForm((f) => ({ ...f, limit: "" }));
  };

  return (
    <section aria-labelledby="budgets-heading" className="mt-10">
      <SectionLabel>
        <span id="budgets-heading">Team budgets</span>
      </SectionLabel>

      {sorted.length === 0 ? (
        <EmptyState
          icon={Wallet}
          compact
          title="No team budgets"
          description={departments.length ? "Set a monthly or quarterly limit for a team. Requests are held against it while they await approval." : "Budgets are per team. Add departments to the company first."}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {sorted.map((b) => {
            const past = b.period_end < today;
            const meter = { amount: b.balance.limit, committed: b.balance.held + b.balance.committed, consumed: b.balance.consumed, remaining: b.balance.remaining, usedPct: b.balance.usedPct, overrun: b.balance.overrun };
            return (
              <li key={b.id} className={cn("panel grid gap-3 p-4", past && "opacity-70")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-fg text-body font-medium">{b.departmentName}</span>
                  <span className="text-fg-subtle text-caption">{periodLabel(b.period, b.period_start)}</span>
                  <Pill tone={b.enforcement === "block" ? "error" : "neutral"} className="ml-auto" title={b.enforcement === "block" ? "Spend past the limit is refused" : "Spend past the limit needs sign-off"}>
                    {b.enforcement === "block" ? "Hard cap" : "Sign-off past limit"}
                  </Pill>
                  {canManage && b.holds.length === 0 ? (
                    <button type="button" className="btn btn-ghost btn-icon" aria-label={`Delete ${b.departmentName}'s budget`} disabled={remove.pending} onClick={() => remove.run(() => budgetCommandAction(companyId, { action: "delete", id: b.id }), { failure: "Couldn't delete the budget" })}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
                <BudgetMeter balance={meter} showLegend />
                <dl className="grid grid-cols-4 gap-2 text-caption">
                  {[
                    ["Limit", b.balance.limit],
                    ["Held", b.balance.held],
                    ["Committed", b.balance.committed + b.balance.consumed],
                    ["Left", b.balance.remaining],
                  ].map(([label, v]) => (
                    <div key={label as string}>
                      <dt className="label-mono">{label}</dt>
                      <dd className={cn("figure", label === "Left" && b.balance.overrun ? "text-rose" : "text-fg")}>{formatINR(v as number)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      {canManage && departments.length ? (
        <form onSubmit={submit} className="panel mt-3 grid gap-3 p-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr_auto] sm:items-end" aria-label="Set a team budget">
          <label className="grid gap-1 text-caption">
            <span className="text-fg-subtle">Team</span>
            <NativeSelect value={form.departmentId} onChange={set("departmentId")}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-caption">
            <span className="text-fg-subtle">Period</span>
            <NativeSelect value={form.period} onChange={set("period")}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly (FY)</option>
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-caption">
            <span className="text-fg-subtle">{form.period === "monthly" ? "Month" : "Quarter containing"}</span>
            <input type="month" className="field font-mono" value={form.month} onChange={set("month")} required />
          </label>
          <label className="grid gap-1 text-caption">
            <span className="text-fg-subtle">Limit (₹, pre-GST)</span>
            <input className="field font-mono" inputMode="decimal" value={form.limit} onChange={set("limit")} required placeholder="500000" />
          </label>
          <label className="grid gap-1 text-caption">
            <span className="text-fg-subtle">Past the limit</span>
            <NativeSelect value={form.enforcement} onChange={set("enforcement")}>
              <option value="approval">Needs sign-off</option>
              <option value="block">Refuse (hard cap)</option>
            </NativeSelect>
          </label>
          <button type="submit" className="btn btn-secondary" disabled={save.pending}>
            {save.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Save
          </button>
        </form>
      ) : null}
      <p className="text-fg-faint mt-2 text-caption leading-5">
        Saving a team&apos;s budget for a period it already has replaces the limit. A budget can only be deleted before anything draws from it.
      </p>
    </section>
  );
}
