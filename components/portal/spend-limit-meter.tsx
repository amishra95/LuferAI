import { budgetTone, CRITICAL_PCT } from "@/lib/procurement/po-ledger";
import { cn, formatINR } from "@/lib/utils";

const TONE_TEXT = { ok: "text-fg-subtle", watch: "text-warn", critical: "text-warn", over: "text-rose" } as const;
const TONE_NOTE = { ok: null, watch: "approaching the limit", critical: "nearly at the limit", over: "over the limit: new requests for this month need two-tier sign-off" } as const;

/**
 * The company's monthly spend limit against what's committed for events this
 * month (bookings and catalogue orders, the same figure the approval policy
 * checks: lib/policies/checkBookingPolicy.ts). Colour follows the PO meters:
 * amber from 90%, red over the limit, a text warning from 75%.
 */
export function SpendLimitMeter({ committed, limit, month, className }: { committed: number; limit: number; month: string; className?: string }) {
  const pct = limit > 0 ? (committed / limit) * 100 : 0;
  const tone = budgetTone({ usedPct: pct, overrun: committed > limit });
  const note = TONE_NOTE[tone];
  return (
    <section aria-label="Monthly spend limit" className={cn("panel px-5 py-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="label-mono">Committed for events in {month}</h2>
        <p className="font-mono text-[13px] tabular-nums">
          <span className="text-fg">{formatINR(committed)}</span>
          <span className="text-fg-subtle"> / {formatINR(limit)} monthly limit</span>
        </p>
      </div>
      <div
        role="meter"
        aria-label={`${Math.round(pct)}% of the monthly limit committed: ${formatINR(committed)} of ${formatINR(limit)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(pct))}
        className={cn("bg-surface-raised border-line relative mt-3 h-2.5 overflow-hidden rounded-sm border", tone === "over" && "border-rose/40")}
      >
        <span
          className={cn("absolute inset-y-0 left-0 transition-[width] duration-500 ease-out motion-reduce:transition-none", tone === "over" ? "bg-rose" : tone === "critical" ? "bg-warn" : "bg-fg")}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        <span aria-hidden className="bg-fg-faint absolute inset-y-0 w-px" style={{ left: `${CRITICAL_PCT}%` }} />
      </div>
      <p className={cn("mt-2 font-mono text-[11.5px] tabular-nums", TONE_TEXT[tone])}>
        {Math.round(pct)}% used · {committed > limit ? `${formatINR(committed - limit)} over` : `${formatINR(limit - committed)} left`}
        {note ? ` · ${note}` : ""}
      </p>
    </section>
  );
}
