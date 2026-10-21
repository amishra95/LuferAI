"use client";

import { useState } from "react";
import { Check, Loader2, Lock, Pencil, Plus, X } from "lucide-react";

import { setBookingCostCenter } from "../actions";
import { useOptimisticMutation } from "@/components/workspace/use-optimistic-mutation";
import { validateCostCentre } from "@/lib/bookings/expense-meta";
import { cn } from "@/lib/utils";

/**
 * The bookings table's cost centre, editable in place: click to edit, Enter to
 * save, Escape to cancel. Suggestions come from the company's other cost
 * centres (a shared <datalist>). Optimistic; a refusal rolls back with the
 * server's reason. When it can't change, `locked` says why.
 */
export function CostCentreCell({
  bookingId,
  value: saved,
  projectCode,
  listId,
  locked,
}: {
  bookingId: string;
  value: string | null;
  projectCode: string | null;
  /** id of the <datalist> of known cost centres. */
  listId: string;
  /** Why it can't be edited, or null when it can. */
  locked: string | null;
}) {
  const { value, mutate, pending } = useOptimisticMutation(saved);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);

  const project = projectCode ? <div className="text-fg-subtle">{projectCode}</div> : null;

  if (locked) {
    return (
      <div className="font-mono text-caption" title={locked}>
        {value ? (
          <span className="inline-flex items-center gap-1">
            {value}
            <Lock className="text-fg-faint size-3" aria-label={locked} />
          </span>
        ) : (
          <span className="text-fg-faint font-sans">Unassigned</span>
        )}
        {project}
      </div>
    );
  }

  const start = () => {
    setDraft(value ?? "");
    setError(null);
    setEditing(true);
  };

  async function save() {
    const valid = validateCostCentre(draft);
    if (!valid.ok) return setError(valid.error);
    if (valid.value === value) return setEditing(false);
    setError(null);
    setEditing(false);
    await mutate({
      apply: () => valid.value,
      action: () => setBookingCostCenter(bookingId, valid.value),
      commit: (_, r) => r.costCenter,
      failure: "Couldn't change the cost centre",
      success: (r) => ({ tone: "success", title: `Cost centre set to ${r.costCenter}` }),
    });
  }

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="grid gap-1"
      >
        <div className="flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            list={listId}
            maxLength={32}
            autoFocus
            aria-label="Cost centre"
            aria-invalid={Boolean(error)}
            placeholder="e.g. ENG-BLR"
            className="field h-7 w-28 px-2 font-mono text-caption uppercase"
          />
          <button type="submit" aria-label="Save cost centre" className="btn btn-icon size-7">
            <Check className="size-3.5" aria-hidden />
          </button>
          <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="btn btn-ghost btn-icon size-7">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-rose max-w-48 text-caption leading-4">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="font-mono text-caption">
      {value ? (
        <button
          type="button"
          onClick={start}
          title="Change cost centre"
          className="group hover:border-line-strong -mx-1.5 inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-left"
        >
          {value}
          {pending ? <Loader2 className="text-fg-subtle size-3 animate-spin" aria-label="Saving" /> : <Pencil className="text-fg-faint size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
          <span className="sr-only">, change</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          className={cn("border-line-strong text-fg-subtle hover:text-fg hover:border-fg-subtle inline-flex h-6 items-center gap-1 rounded-md border border-dashed px-2 font-sans text-caption")}
        >
          <Plus className="size-3" aria-hidden /> Assign
        </button>
      )}
      {project}
    </div>
  );
}
