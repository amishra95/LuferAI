"use client";

import { useState } from "react";
import { Loader2, Pencil, Scale, Trash2 } from "lucide-react";

import { approvalCommandAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/portal/empty-state";
import { Pill } from "@/components/portal/pills";
import { NativeSelect } from "@/components/ui/native-select";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { bandLabel, DEFAULT_SLA_HOURS, MAX_LEVELS, type ApprovalRule } from "@/lib/services/enterprise/approvalEngine";
import { cn } from "@/lib/utils";

interface Draft {
  id?: string;
  name: string;
  departmentId: string;
  minAmount: string;
  maxAmount: string;
  levels: string;
  slaHours: string;
}

const EMPTY: Draft = { name: "", departmentId: "", minAmount: "", maxAmount: "", levels: "1", slaHours: String(DEFAULT_SLA_HOURS) };

const draftOf = (r: ApprovalRule): Draft => ({
  id: r.id,
  name: r.name,
  departmentId: r.department_id ?? "",
  minAmount: String(r.min_amount_inr),
  maxAmount: r.max_amount_inr === null ? "" : String(r.max_amount_inr),
  levels: String(r.approval_levels),
  slaHours: String(r.sla_hours),
});

const hours = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} h`);

/**
 * Approval rules (approval_policy_rules): amount bands that set how many tiers
 * of the hierarchy sign off, one after another, and how long each step has
 * before it escalates. Amounts at or below every band bypass rule-based sign-off.
 */
export function RuleManager({
  companyId,
  rules,
  departments,
  canManage,
}: {
  companyId: string | null;
  rules: ApprovalRule[];
  departments: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const save = useAction<unknown>();
  const row = useAction<unknown>();
  const team = (id: string | null) => (id ? (departments.find((d) => d.id === id)?.name ?? "Unknown team") : "All teams");
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const sorted = [...rules].sort((a, b) => Number(a.department_id !== null) - Number(b.department_id !== null) || a.min_amount_inr - b.min_amount_inr);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const outcome = await save.run(
      () =>
        approvalCommandAction(companyId, {
          action: "saveRule",
          id: draft.id,
          name: draft.name,
          departmentId: draft.departmentId || null,
          minAmount: draft.minAmount,
          maxAmount: draft.maxAmount || null,
          levels: draft.levels,
          slaHours: draft.slaHours,
        }),
      { failure: "Couldn't save the rule", success: () => ({ tone: "success", title: draft.id ? "Rule updated" : "Rule added", description: "It applies to new requests." }) }
    );
    if (outcome?.ok) setDraft(EMPTY);
  };

  return (
    <section aria-labelledby="rules-heading">
      <SectionLabel>
        <span id="rules-heading">Approval rules</span>
      </SectionLabel>

      {sorted.length === 0 ? (
        <EmptyState
          icon={Scale}
          compact
          title="No approval rules"
          description="Without rules, only corporate policy (approval and high-value thresholds, the monthly limit) decides sign-off. Add a band to require levels of approval above an amount."
        />
      ) : (
        <ul className="panel divide-line divide-y">
          {sorted.map((r) => (
            <li key={r.id} className={cn("grid gap-1 px-3 py-2.5", !r.is_active && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-fg text-[13px] font-medium">{r.name}</span>
                <span className="text-fg-subtle text-[12px]">{team(r.department_id)}</span>
                {!r.is_active ? <Pill tone="neutral">Paused</Pill> : null}
                {canManage ? (
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="btn btn-ghost h-7 px-2 text-[12px]" disabled={row.pending} onClick={() =>
                      row.run(() => approvalCommandAction(companyId, { action: "setRuleActive", id: r.id, active: !r.is_active }), {
                        failure: r.is_active ? "Couldn't pause the rule" : "Couldn't resume the rule",
                      })
                    }>
                      {r.is_active ? "Pause" : "Resume"}
                    </button>
                    <button type="button" className="btn btn-ghost btn-icon" aria-label={`Edit ${r.name}`} onClick={() => setDraft(draftOf(r))}>
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button type="button" className="btn btn-ghost btn-icon" aria-label={`Delete ${r.name}`} disabled={row.pending} onClick={() => {
                      if (!confirm(`Delete “${r.name}”? Requests it already routed keep their approvers.`)) return;
                      row.run(() => approvalCommandAction(companyId, { action: "deleteRule", id: r.id }), { failure: "Couldn't delete the rule" });
                    }}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ) : null}
              </div>
              <div className="figure text-fg-muted text-[12px]">
                {bandLabel(r)} · {r.approval_levels} level{r.approval_levels === 1 ? "" : "s"}, in order · {hours(r.sla_hours)} per step
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={submit} className="panel mt-3 grid gap-3 p-3 sm:grid-cols-6" aria-label={draft.id ? "Edit rule" : "Add rule"}>
          <label className="grid gap-1 text-[12px] sm:col-span-3">
            <span className="text-fg-subtle">Name</span>
            <input className="field" value={draft.name} onChange={set("name")} maxLength={80} required placeholder="e.g. Large events" />
          </label>
          <label className="grid gap-1 text-[12px] sm:col-span-3">
            <span className="text-fg-subtle">Applies to</span>
            <NativeSelect value={draft.departmentId} onChange={set("departmentId")}>
              <option value="">All teams</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-[12px] sm:col-span-2">
            <span className="text-fg-subtle">Above (₹, pre-GST)</span>
            <input className="field font-mono" inputMode="decimal" value={draft.minAmount} onChange={set("minAmount")} placeholder="0" />
          </label>
          <label className="grid gap-1 text-[12px] sm:col-span-2">
            <span className="text-fg-subtle">Up to (₹, blank = no limit)</span>
            <input className="field font-mono" inputMode="decimal" value={draft.maxAmount} onChange={set("maxAmount")} placeholder="No limit" />
          </label>
          <label className="grid gap-1 text-[12px]">
            <span className="text-fg-subtle">Levels</span>
            <NativeSelect value={draft.levels} onChange={set("levels")}>
              {Array.from({ length: MAX_LEVELS }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-[12px]">
            <span className="text-fg-subtle">Hours per step</span>
            <input className="field font-mono" inputMode="numeric" value={draft.slaHours} onChange={set("slaHours")} />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-6">
            {draft.id ? (
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(EMPTY)}>
                Cancel
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={save.pending}>
              {save.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {draft.id ? "Save rule" : "Add rule"}
            </button>
          </div>
        </form>
      ) : null}
      <p className="text-fg-faint mt-2 text-[12px] leading-5">
        A team&apos;s own band wins over an all-teams one. When policy, a budget or a PO also asks for sign-off, the strictest number of levels applies. A step left past its deadline escalates to the next tier up.
      </p>
    </section>
  );
}
