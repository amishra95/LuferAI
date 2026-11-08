import { Pill } from "@/components/portal/pills";
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, requestSummary, statusOf } from "@/lib/concierge/requests";
import type { ConciergeRequest } from "@/lib/supabase/database.types";

const sentOn = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** A company's quote requests and briefs on Home, with where each stands and Lufer's latest note. */
export function RequestList({ requests }: { requests: ConciergeRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="requests-heading" className="mb-10">
      <h2 id="requests-heading" className="text-fg mb-3 text-body font-semibold tracking-tight">
        Requests
      </h2>
      <ul className="panel divide-line divide-y">
        {requests.map((r) => {
          const status = statusOf(r.status);
          return (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3">
              <div className="min-w-0">
                <p className="text-fg truncate text-meta font-medium">{requestSummary(r)}</p>
                <p className="text-fg-subtle text-caption">
                  {sentOn(r.created_at)}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </div>
              <Pill tone={REQUEST_STATUS_TONE[status]}>{REQUEST_STATUS_LABEL[status]}</Pill>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
