import { budgetTone, CRITICAL_PCT, meterSegments, type BudgetTone, type PoBalance } from "@/lib/procurement/po-ledger";
import { cn, formatINR } from "@/lib/utils";

const TONE_TEXT: Record<BudgetTone, string> = { ok: "", watch: "text-warn", critical: "text-warn", over: "text-rose" };
const TONE_LABEL: Record<BudgetTone, string | null> = { ok: null, watch: "watch", critical: "nearly drawn", over: "overrun" };

/**
 * A PO's budget as a segmented meter: consumed (solid), committed (hatched),
 * remaining (empty), with a tick at the critical threshold. Colour changes only
 * as the PO nears or passes its limit; monochrome otherwise.
 */
export function BudgetMeter({ balance, size = "md", showLegend = false, className }: { balance: PoBalance; size?: "sm" | "md"; showLegend?: boolean; className?: string }) {
  const seg = meterSegments(balance);
  const tone = budgetTone(balance);
  const label = `${Math.round(balance.usedPct)}% drawn: ${formatINR(balance.consumed)} consumed, ${formatINR(balance.committed)} committed, ${formatINR(balance.remaining)} remaining of ${formatINR(balance.amount)}`;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(balance.usedPct))}
        className={cn("bg-surface-raised border-line relative overflow-hidden rounded-sm border", size === "sm" ? "h-1.5" : "h-2.5", tone === "over" && "border-rose/40")}
      >
        <span
          className={cn("absolute inset-y-0 left-0 transition-[width] duration-500 ease-out motion-reduce:transition-none", tone === "over" ? "bg-rose" : tone === "critical" ? "bg-warn" : "bg-fg")}
          style={{ width: `${seg.consumed}%` }}
        />
        <span
          className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--color-fg-subtle)_0_3px,transparent_3px_6px)] transition-[left,width] duration-500 ease-out motion-reduce:transition-none"
          style={{ left: `${seg.consumed}%`, width: `${seg.committed}%` }}
        />
        <span aria-hidden className="bg-fg-faint absolute inset-y-0 w-px" style={{ left: `${CRITICAL_PCT}%` }} />
      </div>
      {showLegend ? (
        <div className="text-fg-subtle flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="bg-fg size-2 rounded-[2px]" /> consumed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px] bg-[repeating-linear-gradient(135deg,var(--color-fg-subtle)_0_2px,transparent_2px_4px)]" /> committed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="bg-fg-faint h-2 w-px" /> {CRITICAL_PCT}%
          </span>
          {TONE_LABEL[tone] ? <span className={cn("ml-auto", TONE_TEXT[tone])}>{TONE_LABEL[tone]}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export { TONE_LABEL as BUDGET_TONE_LABEL, TONE_TEXT as BUDGET_TONE_TEXT };
