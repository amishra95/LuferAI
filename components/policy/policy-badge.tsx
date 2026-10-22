import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";

import { Pill, type PillTone } from "@/components/portal/pills";
import type { PolicyCheck, PolicyStatus } from "@/lib/policies/evaluate-booking-policy";
import { cn } from "@/lib/utils";

/** Colour and words per outcome: green auto-approved, amber manager, red CFO or blocked. */
export const POLICY_STATUS_META: Record<PolicyStatus, { tone: PillTone; label: string; title: string; icon: typeof CheckCircle2 }> = {
  in_policy: { tone: "ok", label: "In policy · auto-approved", title: "In policy: auto-approved", icon: CheckCircle2 },
  requires_manager: { tone: "warn", label: "Manager approval", title: "Requires manager approval", icon: AlertTriangle },
  requires_cfo: { tone: "error", label: "CFO approval", title: "Requires CFO approval", icon: ShieldAlert },
  out_of_policy: { tone: "error", label: "Out of policy", title: "Out of policy: can't be booked", icon: XCircle },
};

/**
 * A venue's or request's policy outcome as a pill, e.g. "Manager approval ·
 * ₹1,500–₹3,000/head". The reason rides in the tooltip and for screen readers.
 */
export function PolicyBadge({ status, range, reason, className }: { status: PolicyStatus; range?: string; reason?: string; className?: string }) {
  const meta = POLICY_STATUS_META[status];
  return (
    <Pill tone={meta.tone} title={reason ? `${meta.title}: ${reason}` : meta.title} className={className}>
      {meta.label}
      {range ? <span className="font-normal">· {range}</span> : null}
      {reason ? <span className="sr-only">: {reason}</span> : null}
    </Pill>
  );
}

const PANEL: Record<PillTone, string> = {
  ok: "border-sage/40",
  warn: "border-warn/50",
  error: "border-rose/50",
  highlight: "border-warn/50",
  neutral: "border-line",
};
const ICON: Record<PillTone, string> = { ok: "text-sage", warn: "text-warn", error: "text-rose", highlight: "text-warn", neutral: "text-fg-subtle" };

/**
 * The policy breakdown shown before a booking or RFP is sent: the outcome,
 * why, and one line per rule the company has set.
 */
export function PolicyBanner({
  status,
  reason,
  checks,
  context = "booking",
  className,
}: {
  status: PolicyStatus;
  reason?: string;
  checks: PolicyCheck[];
  /** booking: sign-off happens before the venue sees it. rfp: venues quote now; booking a quote needs the sign-off. */
  context?: "booking" | "rfp";
  className?: string;
}) {
  const meta = POLICY_STATUS_META[status];
  const Icon = meta.icon;
  const signOff = status === "requires_cfo" ? "manager and CFO" : "manager";
  const summary =
    status === "in_policy"
      ? "Within your company's policy: no sign-off needed."
      : status === "out_of_policy"
        ? `This can't be booked: ${reason}.`
        : context === "rfp"
          ? `Booking any of these quotes will need ${signOff} sign-off, because ${reason}.`
          : `Needs ${signOff} sign-off before the venue sees it, because ${reason}.`;
  return (
    <section aria-label="Spend policy" className={cn("bg-surface grid gap-3 rounded-md border p-3 text-body", PANEL[meta.tone], className)}>
      <div className="flex gap-3" role="status">
        <Icon className={cn("mt-0.5 size-4 shrink-0", ICON[meta.tone])} aria-hidden />
        <div className="grid gap-0.5">
          <p className="text-fg font-medium">{meta.title}</p>
          <p className="text-muted-foreground">{summary}</p>
        </div>
      </div>
      {checks.length ? (
        <ul className="border-line grid gap-1.5 border-t pt-3 text-caption" aria-label="Policy checks">
          {checks.map((c) => (
            <li key={c.rule} className="flex items-baseline gap-2">
              {c.ok ? <CheckCircle2 className="text-sage size-3.5 shrink-0 self-center" aria-hidden /> : <AlertTriangle className="text-warn size-3.5 shrink-0 self-center" aria-hidden />}
              <span className="text-fg-muted min-w-32 font-medium">{c.label}</span>
              <span className="text-fg-subtle">
                <span className="sr-only">{c.ok ? "OK: " : "Needs attention: "}</span>
                {c.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
