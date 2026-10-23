import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Soft tile, strong glyph: emerald and graphite accents on the linen landing.
const ACCENTS = {
  emerald: "bg-emerald-soft text-emerald-ink",
  graphite: "bg-graphite/[0.07] text-graphite",
} as const;

export type Accent = keyof typeof ACCENTS;

export function IconTile({ icon: Icon, accent, className }: { icon: LucideIcon; accent: Accent; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-11 shrink-0 place-items-center rounded-xl", ACCENTS[accent], className)}>
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  );
}
