"use client";

import { useCompletion } from "@ai-sdk/react";
import { FileText, Loader2, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Button } from "@/components/ui/button";

// react-markdown escapes raw HTML by default, so model output can't inject markup.
const markdownComponents = {
  h2: (props: React.ComponentProps<"h2">) => <h2 className="mt-4 mb-1 text-sm font-semibold first:mt-0" {...props} />,
  h3: (props: React.ComponentProps<"h3">) => <h3 className="mt-3 mb-1 text-sm font-medium" {...props} />,
  p: (props: React.ComponentProps<"p">) => <p className="my-1.5" {...props} />,
  ul: (props: React.ComponentProps<"ul">) => <ul className="my-1.5 list-disc pl-5" {...props} />,
  ol: (props: React.ComponentProps<"ol">) => <ol className="my-1.5 list-decimal pl-5" {...props} />,
  strong: (props: React.ComponentProps<"strong">) => <strong className="font-semibold" {...props} />,
};

/** Host view: generates and streams an AI event brief for one booking. */
export function EventBrief({ bookingId, venueId }: { bookingId: string; venueId: string }) {
  const { completion, complete, isLoading, error, stop } = useCompletion({
    api: "/api/ai/generate-brief",
    id: `brief-${bookingId}`,
    body: { venueId },
  });

  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={isLoading} onClick={() => complete(bookingId)}>
          {isLoading ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
          {completion ? "Regenerate brief" : "Generate event brief"}
        </Button>
        {isLoading ? (
          <Button type="button" size="sm" variant="ghost" onClick={stop}>
            <Square aria-hidden /> Stop
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {briefErrorMessage(error)}
        </p>
      ) : null}
      {completion ? (
        <article className="bg-muted/40 rounded-lg border p-4 text-sm" aria-live="polite" aria-busy={isLoading}>
          <ReactMarkdown components={markdownComponents}>{completion}</ReactMarkdown>
        </article>
      ) : null}
    </div>
  );
}

// The route answers errors as JSON ({ error }); surface that text, not the raw body.
function briefErrorMessage(error: Error) {
  try {
    return (JSON.parse(error.message) as { error?: string }).error ?? error.message;
  } catch {
    return error.message || "Couldn't generate the brief.";
  }
}
