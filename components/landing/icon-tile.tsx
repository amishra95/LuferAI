import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Muted tile, vibrant glyph: the landing's three accents.
const ACCENTS = {
  coral: "bg-coral/12 text-coral ring-coral/25",
  mint: "bg-mint/12 text-mint ring-mint/25",
  gold: "bg-gold/12 text-gold ring-gold/25",
} as const;

export type Accent = keyof typeof ACCENTS;

export function IconTile({ icon: Icon, accent, className }: { icon: LucideIcon; accent: Accent; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-11 shrink-0 place-items-center rounded-control ring-1 ring-inset", ACCENTS[accent], className)}>
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  );
}
