import { cn } from "@/lib/utils";

/**
 * Status labels: a soft tinted badge with dark text of the same family, plus a
 * dot. The text always names the state, so it never rides on colour alone.
 * `highlight` (gold) marks savings and top picks.
 */
const DOT = {
  ok: "bg-sage",
  warn: "bg-warn",
  error: "bg-rose",
  highlight: "bg-warn",
  neutral: "bg-fg-faint",
} as const;

const TONE = {
  ok: "badge-success",
  warn: "badge-warn",
  error: "badge-danger",
  highlight: "badge-warn",
  neutral: "border-line text-fg-muted",
} as const;

export type PillTone = keyof typeof DOT;

export function Pill({ tone, children, title, className }: { tone: PillTone; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "rounded-badge inline-flex h-5 items-center gap-1.5 border px-2 text-caption font-medium whitespace-nowrap tabular-nums",
        TONE[tone],
        className
      )}
    >
      <span aria-hidden className={cn("status-dot", DOT[tone])} />
      {children}
    </span>
  );
}

export const InPolicyPill = () => <Pill tone="ok">In policy</Pill>;

export const OutOfPolicyPill = ({ reasons }: { reasons?: string }) => (
  <Pill tone="error" title={reasons}>
    Out of policy
  </Pill>
);

export const PendingApprovalPill = () => <Pill tone="warn">Pending approval</Pill>;

export const RejectedPill = () => <Pill tone="error">Rejected</Pill>;

/** `label` summarises the corporate rate card, e.g. "−15%" or "₹1,600/head". */
export const RateCardPill = ({ label }: { label: string }) => (
  <Pill tone="highlight" title="Your company's negotiated rate applies">
    Rate card {label}
  </Pill>
);

export const HoldActivePill = ({ label }: { label?: string }) => (
  <Pill tone="warn">
    Hold active{label ? ` · ${label}` : ""}
  </Pill>
);
