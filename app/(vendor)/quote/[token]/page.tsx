import type { Metadata } from "next";
import { CalendarDays, Clock, IndianRupee, Leaf, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dietaryLabel } from "@/lib/quotes";
import { formatDate, formatINR } from "@/lib/utils";
import { loadVendorQuote, type VendorQuoteLoad } from "@/lib/vendor/quote-service";
import { QuoteForm } from "./_components/quote-form";

// The token in the URL is a credential: keep it out of Referer headers and search engines.
export const metadata: Metadata = { title: "Send your quote", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { quoted: "Standard price sent", countered: "Your counter sent", declined: "Declined", no_fit: "Not a fit" } as const;

const NOTICE: Record<Exclude<VendorQuoteLoad["status"], "open" | "closed">, { title: string; body: string }> = {
  invalid: { title: "This link isn't valid", body: "Check you opened the whole link from the message, or ask the client to send it again." },
  expired: { title: "This link has expired", body: "Quote links work for 7 days. Ask the client for a new one." },
  unavailable: { title: "Quotes are unavailable", body: "We can't take quotes right now. Please try again later." },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(1.5rem+var(--app-safe-top))] pb-[calc(6rem+var(--app-safe-bottom))]">{children}</main>
  );
}

/** A venue manager's view of one RFP: what's asked, and their price, inclusions or a decline. No sign-in. */
export default async function VendorQuotePage({ params }: PageProps<"/quote/[token]">) {
  const { token } = await params;
  const loaded = await loadVendorQuote(token);

  if (loaded.status !== "open" && loaded.status !== "closed") {
    const n = NOTICE[loaded.status];
    return (
      <Shell>
        <Card className="mt-12">
          <CardHeader>
            <CardTitle className="text-section">{n.title}</CardTitle>
            <CardDescription>{n.body}</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const { view } = loaded;
  const { rfp, current } = view;
  const facts = [
    { icon: Users, label: "Guests", value: `${rfp.party_size}` },
    { icon: CalendarDays, label: "Date", value: rfp.event_date ? formatDate(rfp.event_date) : "Flexible" },
    ...(rfp.event_start_time ? [{ icon: Clock, label: "Starts", value: `${rfp.event_start_time.slice(0, 5)} IST` }] : []),
    ...(rfp.budget_per_head_inr != null ? [{ icon: IndianRupee, label: "Budget / head", value: formatINR(rfp.budget_per_head_inr) }] : []),
  ];

  return (
    <Shell>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-fg-subtle text-caption font-medium">For {view.venueName}</p>
            <Badge variant={current.status === "declined" || current.status === "no_fit" ? "outline" : "success"}>{STATUS_LABEL[current.status]}</Badge>
          </div>
          <CardTitle className="text-section">{view.companyName} wants a quote</CardTitle>
          {rfp.event_type ? <CardDescription className="capitalize">{rfp.event_type.replace(/_/g, " ")}</CardDescription> : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-2 gap-3">
            {facts.map(({ icon: Icon, label, value }) => (
              <div key={label} className="border-line rounded-md border px-3 py-2">
                <dt className="text-fg-subtle flex items-center gap-1.5 text-caption">
                  <Icon className="size-3.5" aria-hidden /> {label}
                </dt>
                <dd className="text-body font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {rfp.dietary_tags.length ? (
            <p className="text-fg-muted flex flex-wrap items-center gap-1.5 text-meta">
              <Leaf className="size-3.5" aria-hidden /> {rfp.dietary_tags.map(dietaryLabel).join(" · ")}
            </p>
          ) : null}
          <details className="group">
            <summary className="text-fg-muted cursor-pointer text-meta">Read the full brief</summary>
            <p className="text-fg mt-2 whitespace-pre-line text-body">{rfp.brief}</p>
          </details>
        </CardContent>
      </Card>

      {loaded.status === "open" ? (
        <QuoteForm token={token} partySize={rfp.party_size} packages={view.packages} current={current} />
      ) : (
        <p role="status" className="border-line text-fg-muted rounded-md border px-3 py-2 text-body">
          This RFP is closed: the client has booked or withdrawn it.
          {current.perHeadInr != null && current.status !== "declined" ? ` Your last price was ${formatINR(current.perHeadInr)} a head.` : ""}
        </p>
      )}
      <p className="text-fg-faint text-center text-caption">This link is for {view.venueName} only and works until {formatDate(new Date(view.expiresAt * 1000).toISOString().slice(0, 10))}. Don&apos;t forward it.</p>
    </Shell>
  );
}
