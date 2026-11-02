"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { importDealsCsv, linkBookingToDeal, type ImportResult } from "../actions";
import type { ActionResult } from "@/lib/mutations/dispatch";

/** Upload a deals CSV from the CRM; shows what was imported and the rows that weren't. */
export function ImportDealsForm() {
  const [state, action, pending] = useActionState<ActionResult<ImportResult> | null, FormData>(importDealsCsv, null);
  return (
    <form action={action} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          aria-label="Deals CSV"
          className="text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} Import
        </Button>
      </div>
      <div aria-live="polite" className="text-sm">
        {state?.ok === false && <p className="text-rose">{state.error}</p>}
        {state?.ok && (
          <div className="grid gap-1">
            <p className="text-fg-muted">
              Imported {state.data.imported} deal{state.data.imported === 1 ? "" : "s"} from {state.data.provider}.
            </p>
            {state.data.errors.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-fg-subtle">
                {state.data.errors.map((e) => (
                  <li key={e.line}>
                    Row {e.line}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

/** The deal a booking entertained for; saves on change and rolls back with the reason on failure. */
export function DealSelect({ bookingId, value, deals, disabled }: { bookingId: string; value: string | null; deals: { id: string; label: string }[]; disabled?: boolean }) {
  const [current, setCurrent] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-1">
      <select
        aria-label="Deal"
        value={current}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = current;
          setCurrent(next);
          setError(null);
          start(async () => {
            const res = await linkBookingToDeal(bookingId, next);
            if (!res.ok) {
              setCurrent(prev);
              setError(res.error);
            }
          });
        }}
        className="h-8 w-full max-w-64 rounded-md border border-line bg-surface px-2 text-sm"
      >
        <option value="">No deal</option>
        {deals.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-rose">{error}</p>}
    </div>
  );
}
