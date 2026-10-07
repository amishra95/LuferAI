import type { LucideIcon } from "lucide-react";
import { BadgePercent, CircleSlash, Clock, ShieldAlert, ShieldCheck, Timer } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Status pills: high-contrast text on a tinted fill with a soft glow ring. Every
 * pill pairs an icon with a label, so state never rides on colour alone.
 */
const TONES = {
  emerald: "border-emerald-400/40 bg-emerald-400/10 text-emerald-700 shadow-[0_0_14px_-4px] shadow-emerald-400/60",
  amber: "border-amber-400/40 bg-amber-400/10 text-amber-800 shadow-[0_0_14px_-4px] shadow-amber-400/60",
  sky: "border-sky-400/40 bg-sky-400/10 text-sky-700 shadow-[0_0_14px_-4px] shadow-sky-400/60",
  violet: "border-violet-400/40 bg-violet-400/10 text-violet-100 shadow-[0_0_14px_-4px] shadow-violet-400/60",
  red: "border-red-400/40 bg-red-400/10 text-red-700 shadow-[0_0_14px_-4px] shadow-red-400/60",
  zinc: "border-line bg-surface-raised text-fg",
} as const;

export type PillTone = keyof typeof TONES;

export function Pill({
  tone,
  icon: Icon,
  children,
  title,
  className,
}: {
  tone: PillTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </span>
  );
}

export const InPolicyPill = () => (
  <Pill tone="emerald" icon={ShieldCheck}>
    In Policy
  </Pill>
);

export const OutOfPolicyPill = ({ reasons }: { reasons?: string }) => (
  <Pill tone="red" icon={ShieldAlert} title={reasons}>
    Out of Policy
  </Pill>
);

export const PendingApprovalPill = () => (
  <Pill tone="amber" icon={Clock}>
    Pending Approval
  </Pill>
);

export const RejectedPill = () => (
  <Pill tone="red" icon={CircleSlash}>
    Rejected
  </Pill>
);

/** `label` summarises the corporate rate card, e.g. "−15%" or "₹1,600/head". */
export const RateCardPill = ({ label }: { label: string }) => (
  <Pill tone="violet" icon={BadgePercent} title="Your company's negotiated rate applies">
    Rate Card {label}
  </Pill>
);

export const HoldActivePill = ({ label }: { label?: string }) => (
  <Pill tone="sky" icon={Timer}>
    Hold Active{label ? ` · ${label}` : ""}
  </Pill>
);
