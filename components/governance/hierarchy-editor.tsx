"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Network, Plus, X } from "lucide-react";

import { approvalCommandAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/portal/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import type { HierarchyTier } from "@/lib/services/enterprise/governanceStore";

/**
 * The approval hierarchy (approval_chains): tier 1 signs first. Reorder, add
 * or remove Approvers, then save the whole order at once. Requests already
 * raised keep their approvers.
 */
export function HierarchyEditor({
  companyId,
  tiers,
  candidates,
  canManage,
  warning,
}: {
  companyId: string | null;
  tiers: HierarchyTier[];
  candidates: { id: string; name: string }[];
  canManage: boolean;
  warning: string | null;
}) {
  const [order, setOrder] = useState(tiers.map((t) => ({ id: t.userId, name: t.name })));
  const [adding, setAdding] = useState("");
  const act = useAction<unknown>();
  const dirty = order.map((o) => o.id).join() !== tiers.map((t) => t.userId).join();
  const available = candidates.filter((c) => !order.some((o) => o.id === c.id));

  const move = (i: number, by: -1 | 1) =>
    setOrder((o) => {
      const next = [...o];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  const save = () =>
    act.run(() => approvalCommandAction(companyId, { action: "saveHierarchy", approverIds: order.map((o) => o.id) }), {
      failure: "Couldn't save the approval chain",
      success: () => ({ tone: "success", title: "Approval chain saved", description: "New requests follow this order." }),
    });

  return (
    <section aria-labelledby="hierarchy-heading">
      <SectionLabel>
        <span id="hierarchy-heading">Approval hierarchy</span>
      </SectionLabel>
      {warning ? <p className="text-warn mb-3 text-meta leading-5">{warning}</p> : null}
      {order.length === 0 ? (
        <EmptyState
          icon={Network}
          compact
          title="No approvers yet"
          description="Requests that need sign-off can't be submitted until someone is on the chain. Add an Approver to make them tier 1."
        />
      ) : (
        <ol className="panel divide-line divide-y">
          {order.map((o, i) => (
            <li key={o.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <span className="figure text-fg-subtle w-12 shrink-0 text-caption">Tier {i + 1}</span>
              <span className="text-fg min-w-0 flex-1 truncate text-meta">{o.name}</span>
              {canManage ? (
                <span className="flex shrink-0 gap-1">
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={`Move ${o.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={`Move ${o.name} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={`Remove ${o.name}`} onClick={() => setOrder((x) => x.filter((y) => y.id !== o.id))}>
                    <X className="size-3.5" aria-hidden />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {canManage ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <NativeSelect value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Approver to add" className="min-w-0 flex-1" disabled={available.length === 0}>
            <option value="">{available.length ? "Add an Approver…" : "Every Approver is on the chain"}</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <button
            type="button"
            className="btn"
            disabled={!adding || order.length >= 10}
            onClick={() => {
              const c = candidates.find((x) => x.id === adding);
              if (c) setOrder((o) => [...o, c]);
              setAdding("");
            }}
          >
            <Plus className="size-3.5" aria-hidden /> Add
          </button>
          <button type="button" className="btn btn-secondary" disabled={!dirty || act.pending} onClick={save}>
            {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Save order
          </button>
        </div>
      ) : null}
      <p className="text-fg-faint mt-2 text-caption leading-5">
        Only people with the Approver role can be added. Nobody approves their own request: the next tier steps up.
      </p>
    </section>
  );
}
