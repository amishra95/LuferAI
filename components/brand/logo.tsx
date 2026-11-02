import { cn } from "@/lib/utils";

/*
 * Lufer brand: the Diya mark (a lamp bowl with a coral flame: hospitality and
 * celebration) beside "Lufer" in Fraunces, optionally with the tagline beneath.
 * Colours are palette hexes (globals.css), fixed so the mark reads the same in
 * dark mode. The same paths are in app/icon.svg, app/apple-icon.tsx and
 * app/opengraph-image.tsx (keep them in step: DIYA_FLAME / DIYA_BOWL).
 */

/** The mark's two shapes on a 64×64 grid. */
export const DIYA_FLAME = "M32 5C32 5 42.5 16 42.5 23C42.5 28.8 37.8 32 32 32C26.2 32 21.5 28.8 21.5 23C21.5 16 32 5 32 5Z";
export const DIYA_BOWL = "M6 36H58C58 49 46.4 59 32 59C17.6 59 6 49 6 36Z";

const PLUM = "#2a1b3d";
const LINEN = "#faf6f0";
const CORAL = "#ff6b4a";

/** The Diya mark alone. `tone`: the bowl's colour, plum on light grounds, linen on plum. */
export function DiyaMark({ tone = "plum", className, title }: { tone?: "plum" | "linen"; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d={DIYA_FLAME} fill={CORAL} />
      <path d={DIYA_BOWL} fill={tone === "linen" ? LINEN : PLUM} />
    </svg>
  );
}

export function Logo({
  size = "md",
  tagline = true,
  tone = "plum",
  className,
}: {
  size?: "sm" | "md" | "lg";
  tagline?: boolean;
  /** Plum on light grounds (default), linen on plum. */
  tone?: "plum" | "linen";
  className?: string;
}) {
  const text = tone === "linen" ? "text-linen" : "text-plum";
  return (
    <div className={cn("inline-flex flex-col items-center text-center", className)}>
      <span
        className={cn(
          "flex items-center leading-none",
          size === "sm" && "gap-2 text-2xl",
          size === "md" && "gap-2.5 text-4xl",
          size === "lg" && "gap-3 text-5xl sm:text-6xl",
        )}
      >
        <DiyaMark tone={tone} className="size-[1.05em]" />
        <span className={cn("font-display font-semibold tracking-tight", text)}>Lufer</span>
      </span>
      {tagline ? <span className={cn("mt-2 text-sm font-medium tracking-wide", tone === "linen" ? "text-linen/80" : "text-plum/80")}>Your Corporate Entertainment Concierge</span> : null}
    </div>
  );
}
