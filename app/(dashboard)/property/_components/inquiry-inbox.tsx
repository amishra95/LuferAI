import { CalendarCheck, CalendarX2, Mail, MessageSquare, Phone, Share2, Users } from "lucide-react";

import { CopyButton } from "@/components/portal/copy-button";
import { EmptyState } from "@/components/portal/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import { formatEventDate, missingDetails, type InquiryStatus } from "@/lib/venues/inquiry";
import type { InquiryRow } from "@/lib/venues/inquiry-store";
import { setInquiryStatusAction } from "../actions";

const STATUS: Record<InquiryStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "outline" }> = {
  open: { label: "In conversation", variant: "secondary" },
  qualified: { label: "Ready to quote", variant: "success" },
  referred: { label: "Sent to other venues", variant: "warning" },
  converted: { label: "Won", variant: "success" },
  closed: { label: "Closed", variant: "outline" },
};

const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function StatusForm({ inquiry, venueId, status, label, variant = "outline" }: { inquiry: InquiryRow; venueId: string; status: InquiryStatus; label: string; variant?: "default" | "outline" | "ghost" }) {
  return (
    <form action={setInquiryStatusAction}>
      <input type="hidden" name="inquiry_id" value={inquiry.id} />
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

/**
 * The venue's leads from its AI inquiry agent: what each one needs, whether
 * the date was free, where it was referred when it wasn't, and the
 * conversation. The link at the top is what the venue shares (website,
 * Instagram bio, email signature).
 */
export function InquiryInbox({ venueId, venueName, link, inquiries, names }: { venueId: string; venueName: string; link: string; inquiries: InquiryRow[]; names: Map<string, string> }) {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="size-4" aria-hidden /> Your inquiry link
          </CardTitle>
          <CardDescription>
            Put it on your website, Instagram bio and email signature. An AI assistant answers from {venueName}&apos;s own details, checks your calendar, and collects what you need to quote. When
            you&apos;re booked out, it suggests other venues on Lufer.ai, so the client stays in the network.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="border-line bg-surface-raised max-w-full truncate rounded-md border px-2 py-1 text-meta">{link}</code>
          <CopyButton text={link} label="Copy link" />
          <a href={link} target="_blank" rel="noopener" className="text-link text-meta underline-offset-2 hover:underline">
            Try it
          </a>
        </CardContent>
      </Card>

      {inquiries.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No inquiries yet" description="Share your inquiry link: conversations and leads appear here as they come in." />
      ) : (
        <ul className="grid gap-3">
          {inquiries.map((i) => {
            const missing = missingDetails(i);
            const s = STATUS[i.status];
            return (
              <li key={i.id} className="panel grid gap-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-body font-medium">{[i.contact_name, i.company_name].filter(Boolean).join(" · ") || "Anonymous visitor"}</p>
                    <p className="text-fg-subtle text-caption">Last message {when.format(new Date(i.last_message_at))}</p>
                  </div>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </div>

                <div className="text-fg-muted flex flex-wrap gap-x-4 gap-y-1 text-meta">
                  {i.party_size ? (
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden /> {i.party_size} guests
                    </span>
                  ) : null}
                  {i.event_date ? (
                    <span className="inline-flex items-center gap-1">
                      {i.date_available === false ? <CalendarX2 className="text-rose size-3.5" aria-hidden /> : <CalendarCheck className="size-3.5" aria-hidden />}
                      {formatEventDate(i.event_date)}
                      {i.date_available === false ? " (booked)" : i.date_available ? " (free)" : ""}
                    </span>
                  ) : null}
                  {i.budget_per_head_inr ? <span>{formatINR(i.budget_per_head_inr)}/head</span> : null}
                  {i.occasion ? <span>{i.occasion}</span> : null}
                  {i.contact_email ? (
                    <a href={`mailto:${i.contact_email}`} className="text-link inline-flex items-center gap-1 underline-offset-2 hover:underline">
                      <Mail className="size-3.5" aria-hidden /> {i.contact_email}
                    </a>
                  ) : null}
                  {i.contact_phone ? (
                    <a href={`tel:${i.contact_phone}`} className="text-link inline-flex items-center gap-1 underline-offset-2 hover:underline">
                      <Phone className="size-3.5" aria-hidden /> {i.contact_phone}
                    </a>
                  ) : null}
                </div>

                {missing.length && i.status === "open" ? <p className="text-fg-subtle text-caption">Still collecting: {missing.map((m) => (m === "contact" ? "contact details" : m.replace("_", " "))).join(", ")}.</p> : null}
                {i.referred_venue_ids.length ? (
                  <p className="text-fg-subtle text-caption">
                    Suggested instead: {i.referred_venue_ids.map((id) => names.get(id) ?? "another venue").join(", ")}.
                  </p>
                ) : null}

                {i.messages.length ? (
                  <details>
                    <summary className="text-fg-muted cursor-pointer text-meta">Conversation ({i.messages.length} messages)</summary>
                    <ol className="mt-2 grid gap-1.5">
                      {i.messages.map((m, n) => (
                        <li key={n} className="text-meta">
                          <span className="text-fg-subtle font-medium">{m.role === "visitor" ? "Client" : "Assistant"}: </span>
                          <span className="whitespace-pre-line">{m.text}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {i.status === "converted" || i.status === "closed" ? (
                    <StatusForm inquiry={i} venueId={venueId} status={missing.length ? "open" : "qualified"} label="Reopen" variant="ghost" />
                  ) : (
                    <>
                      <StatusForm inquiry={i} venueId={venueId} status="converted" label="Mark won" variant="default" />
                      <StatusForm inquiry={i} venueId={venueId} status="closed" label="Close" />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
