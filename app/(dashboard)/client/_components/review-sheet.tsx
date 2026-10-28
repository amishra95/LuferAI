"use client";

import { useActionState, useState } from "react";
import { Loader2, Star } from "lucide-react";

import { saveReviewAction, type ReviewState } from "../actions";
import { ResponsiveSheetContent } from "@/components/portal/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { MAX_COMMENT_CHARS } from "@/lib/venues/reviews";

const IDLE: ReviewState = { status: "idle" };
const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/**
 * "Rate this event" on a completed booking: 1–5 stars and an optional
 * comment. Opens with the company's existing review to edit it.
 */
export function ReviewSheet({
  bookingId,
  venueName,
  existing,
  className,
}: {
  bookingId: string;
  venueName: string;
  existing: { rating: number; comment: string | null } | null;
  className?: string;
}) {
  const [state, action, pending] = useActionState(saveReviewAction, IDLE);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const shown = hover || rating;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" className={cn("text-fg-subtle hover:text-fg inline-flex items-center gap-1 text-caption underline-offset-2 hover:underline", className)}>
          <Star className={cn("size-3", existing && "text-gold-ink fill-current")} aria-hidden />
          {existing ? `You rated ${existing.rating}/5 · Edit` : "Rate this event"}
        </button>
      </SheetTrigger>
      <ResponsiveSheetContent>
        <SheetHeader className="border-line/60 border-b px-5 pt-5 pb-3 pr-14">
          <SheetTitle>How was {venueName}?</SheetTitle>
          <SheetDescription>Other teams see the venue&apos;s average once it has a few reviews. The venue sees your comment and your company&apos;s name.</SheetDescription>
        </SheetHeader>
        <form action={action} className="grid gap-5 p-5">
          <input type="hidden" name="booking_id" value={bookingId} />
          <input type="hidden" name="rating" value={rating || ""} />
          <fieldset className="grid gap-2">
            <legend className="text-fg-subtle mb-2 text-meta">Rating</legend>
            <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} star${n === 1 ? "" : "s"}: ${WORDS[n]}`}
                  aria-pressed={rating === n}
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  className="focus-visible:ring-ring rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Star className={cn("size-7", n <= shown ? "text-gold-ink fill-current" : "text-fg-faint")} aria-hidden />
                </button>
              ))}
              <span className="text-fg-muted ml-2 text-meta" aria-live="polite">
                {WORDS[shown]}
              </span>
            </div>
          </fieldset>
          <label className="grid gap-1.5 text-meta">
            <span className="text-fg-subtle">What stood out? (optional)</span>
            <textarea
              name="comment"
              defaultValue={existing?.comment ?? ""}
              maxLength={MAX_COMMENT_CHARS}
              rows={4}
              placeholder="Food, service, the room, how the team found it…"
              className="border-line bg-surface text-fg placeholder:text-fg-faint focus-visible:ring-ring rounded-md border px-3 py-2 text-body focus-visible:ring-2 focus-visible:outline-none"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || rating === 0}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} {existing ? "Update review" : "Submit review"}
            </Button>
            {state.message ? (
              <p role={state.status === "error" ? "alert" : "status"} className={cn("text-meta", state.status === "error" ? "text-rose" : "text-sage")}>
                {state.message}
              </p>
            ) : null}
          </div>
        </form>
      </ResponsiveSheetContent>
    </Sheet>
  );
}
