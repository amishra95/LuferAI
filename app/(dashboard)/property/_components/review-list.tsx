import { Star } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VenueReview } from "@/lib/supabase/database.types";
import { formatDate } from "@/lib/utils";
import { RATING_MIN_REVIEWS } from "@/lib/venues/reviews";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={n <= rating ? "text-gold-ink size-3.5 fill-current" : "text-fg-faint size-3.5"} aria-hidden />
      ))}
    </span>
  );
}

/** Clients' reviews of their events here, newest first, with the average clients see on the venue card. */
export function ReviewList({ reviews }: { reviews: (VenueReview & { company_name: string })[] }) {
  const average = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Reviews
          {average != null ? (
            <span className="text-fg-muted inline-flex items-center gap-1 text-meta font-normal">
              <Star className="text-gold-ink size-3.5 fill-current" aria-hidden /> {average.toFixed(1)} · {reviews.length}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          What clients said after their events. Your average shows on your venue card once you have {RATING_MIN_REVIEWS} reviews
          {reviews.length > 0 && reviews.length < RATING_MIN_REVIEWS ? ` (${RATING_MIN_REVIEWS - reviews.length} to go)` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reviews.length === 0 ? (
          <p className="text-fg-subtle text-body">No reviews yet. Clients are asked to rate each event once it&apos;s marked completed.</p>
        ) : (
          <ul className="divide-line divide-y">
            {reviews.map((r) => (
              <li key={r.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars rating={r.rating} />
                  <span className="text-fg text-meta font-medium">{r.company_name}</span>
                  <span className="text-fg-subtle text-caption">{formatDate(r.updated_at.slice(0, 10))}</span>
                </div>
                {r.comment ? <p className="text-fg-muted text-body whitespace-pre-line">{r.comment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
