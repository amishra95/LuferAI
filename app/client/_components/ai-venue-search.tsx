"use client";

import { useState } from "react";
import { ArrowDown, Loader2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VenueOption, VenueSearchFilters } from "@/lib/ai/venue-sourcing";
import { formatINR } from "@/lib/utils";

interface SearchResult {
  filters: VenueSearchFilters;
  options: VenueOption[];
}

export function AiVenueSearch({
  companyId,
  onSelect,
}: {
  companyId: string;
  /** Called with the chosen option and the filters it was found with. */
  onSelect?: (option: VenueOption, filters: VenueSearchFilters) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/source-venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, companyId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed.");
      setResult(body);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mb-6 grid gap-3" aria-label="AI venue search">
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <Sparkles className="text-muted-foreground absolute top-2.5 left-3 size-4" aria-hidden />
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Team dinner for 40 in Indiranagar, ₹2,500 a head, private room"
            aria-label="Describe your event"
            maxLength={500}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending || prompt.trim().length < 3}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Find venues
        </Button>
      </form>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="grid gap-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Understood as:</span>
            <Badge variant="outline">{result.filters.location || "Any location"}</Badge>
            <Badge variant="outline">{result.filters.minCapacity}+ guests</Badge>
            <Badge variant="outline">
              {result.filters.maxBudgetPerHead > 0 ? `≤ ${formatINR(result.filters.maxBudgetPerHead)}/head` : "No budget given"}
            </Badge>
            {result.filters.features.map((f) => (
              <Badge key={f} variant="outline">
                {f}
              </Badge>
            ))}
          </div>

          {result.options.length === 0 ? (
            <p className="text-muted-foreground text-sm">No venues match. Try a larger area, fewer guests or a higher budget.</p>
          ) : (
            <ul className="grid gap-2">
              {result.options.map((o) => (
                <li key={o.venue.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.venue.name}</span>
                    <span className="text-muted-foreground">{o.venue.neighborhood}</span>
                    <Badge variant={o.label === "Policy Compliant" ? "success" : "warning"} className="ml-auto">
                      {o.label}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    Up to {o.venue.capacity_max} guests · min spend {formatINR(o.venue.min_spend_inr)}
                    {o.venue.pdr_available ? " · private dining room" : ""} · est. {formatINR(o.estimatedPerHead)}/head,{" "}
                    {formatINR(o.estimatedTotal)} total
                  </div>
                  {o.policyReason ? <p className="mt-1 text-xs">{o.policyReason}</p> : null}
                  {o.unverifiedFeatures.length > 0 ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Not listed in venue details, confirm with the venue: {o.unverifiedFeatures.join(", ")}
                    </p>
                  ) : null}
                  {onSelect ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => onSelect(o, result.filters)}
                      aria-label={`Select ${o.venue.name} and fill in the request form`}
                    >
                      <ArrowDown aria-hidden /> Select Venue
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
