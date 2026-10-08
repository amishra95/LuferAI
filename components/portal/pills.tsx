import { cn } from "@/lib/utils";

/**
 * Status labels: a solid dot plus mono text in a flat 1px box. The dot carries
 * the state's colour; the text always names it, so state never rides on colour
 * alone.
 */
const DOT = {
  ok: "bg-sage",
  warn: "bg-warn",
  error: "bg-rose",
  neutral: "bg-fg-faint",
} as const;

export type PillTone = keyof typeof DOT;

export function Pill({ tone, children, title, className }: { tone: PillTone; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "border-line text-fg-muted inline-flex h-5 items-center gap-1.5 rounded-[4px] border px-1.5 font-mono text-[10.5px] whitespace-nowrap",
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
  <Pill tone="neutral" title="Your company's negotiated rate applies">
    Rate card {label}
  </Pill>
);

export const HoldActivePill = ({ label }: { label?: string }) => (
  <Pill tone="warn">
    Hold active{label ? ` · ${label}` : ""}
  </Pill>
);
