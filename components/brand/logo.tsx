import { cn } from "@/lib/utils";

/*
 * Lufer.ai wordmark: "Lufer" in plum Fraunces, ".ai" in coral sans on the same
 * baseline, a short coral bar beneath, then the two taglines. Colours are
 * palette tokens (globals.css), fixed so the mark reads the same in dark mode.
 */
export function Logo({
  size = "md",
  taglines = true,
  className,
}: {
  size?: "sm" | "md" | "lg";
  taglines?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-col items-center text-center", className)}>
      <span
        className={cn(
          "flex items-baseline leading-none",
          size === "sm" && "text-2xl",
          size === "md" && "text-4xl",
          size === "lg" && "text-5xl sm:text-6xl",
        )}
      >
        <span className="font-display text-plum font-semibold tracking-tight">Lufer</span>
        <span className="text-coral font-sans text-[0.55em] font-semibold">.ai</span>
      </span>
      <span aria-hidden className={cn("bg-coral mx-auto h-0.5", size === "sm" ? "mt-1.5 w-8" : "mt-2 w-12")} />
      {taglines ? (
        <>
          <span className="text-plum/80 mt-2 text-sm font-medium tracking-wide">Your Corporate Entertainment Concierge</span>
          <span className="text-ink-muted mt-1 text-xs font-medium tracking-[0.2em] uppercase">Team outings across India</span>
        </>
      ) : null}
    </div>
  );
}
