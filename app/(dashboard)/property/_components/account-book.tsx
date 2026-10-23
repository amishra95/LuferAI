import { Briefcase, CalendarClock, Gift, Repeat, Sparkles, TrendingUp, Undo2 } from "lucide-react";

import { EmptyState } from "@/components/portal/empty-state";
import { StatCard } from "@/components/portal/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatINR } from "@/lib/utils";
import { bookSummary, type Account, type AccountStatus, type Opportunity, type OpportunityKind } from "@/lib/venues/accounts";
import { DirectQuote } from "./host-forms";

const STATUS: Record<AccountStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "outline" | "destructive" }> = {
  new: { label: "New", variant: "secondary" },
  active: { label: "Active", variant: "success" },
  due: { label: "Due to rebook", variant: "warning" },
  lapsed: { label: "Lapsed", variant: "destructive" },
};

const KIND_ICON: Record<OpportunityKind, typeof Repeat> = { rebook: Repeat, upcoming_upsell: Gift, win_back: Undo2, first_repeat: Sparkles, premium: TrendingUp };

type QuoteProps = Omit<React.ComponentProps<typeof DirectQuote>, "defaultCompanyId" | "label" | "size">;

/**
 * The venue's corporate book of business (lib/venues/accounts.ts): who books,
 * how much and how often, and the next step with each client, with a direct
 * quote one click away.
 */
export function AccountBook({ accounts, opportunities, quote }: { accounts: Account[]; opportunities: Opportunity[]; quote: QuoteProps }) {
  if (accounts.length === 0) {
    return <EmptyState icon={Briefcase} title="No corporate clients yet" description="Companies appear here once they've booked you, with their history and the next step worth taking." />;
  }
  const summary = bookSummary(accounts);
  const quotable = new Set(quote.companies.map((c) => c.id));

  return (
    <div className="grid gap-6">
      <section className="grid gap-6 sm:grid-cols-3" aria-label="Book of business">
        <StatCard label="Corporate clients" value={String(summary.clients)} hint={`${formatINR(summary.bookedValue)} booked, before GST`} />
        <StatCard label="Came back" value={`${Math.round(summary.repeatRate * 100)}%`} hint="Clients with two or more events" />
        <StatCard label="Largest client" value={`${Math.round(summary.topShare * 100)}%`} hint={`of booked value: ${accounts[0].companyName.replace(" Private Limited", "")}`} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Next steps</CardTitle>
          <CardDescription>One suggestion per client, the most time-sensitive first: rebookings due by their usual rhythm, events coming up, clients gone quiet.</CardDescription>
        </CardHeader>
        <CardContent>
          {opportunities.length === 0 ? (
            <p className="text-fg-subtle text-meta">Nothing needs a nudge right now.</p>
          ) : (
            <ul className="grid gap-3">
              {opportunities.map((o) => {
                const Icon = KIND_ICON[o.kind];
                return (
                  <li key={o.companyId} className="border-line flex flex-wrap items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                    <div className="flex min-w-0 gap-3">
                      <Icon className="text-fg-subtle mt-0.5 size-4 shrink-0" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-body font-medium">
                          {o.companyName.replace(" Private Limited", "")} <span className="text-fg-subtle font-normal">· {o.title}</span>
                        </p>
                        <p className="text-fg-subtle text-meta">{o.detail}</p>
                      </div>
                    </div>
                    {quotable.has(o.companyId) ? <DirectQuote {...quote} key={`quote-${o.companyId}`} defaultCompanyId={o.companyId} label="Send quote" size="sm" /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Every company that has booked you, largest first. Values are before GST.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Booked</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Avg guests</TableHead>
                <TableHead className="text-right">Avg / head</TableHead>
                <TableHead>Rhythm</TableHead>
                <TableHead>Last · next</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.companyId}>
                  <TableCell>
                    {a.companyName.replace(" Private Limited", "")}
                    <span className="text-fg-subtle block text-caption tabular-nums">{Math.round(a.share * 100)}% of your book</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(a.bookedValue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.events}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.avgParty}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(a.avgPerHead)}</TableCell>
                  <TableCell className="text-fg-subtle text-meta">{a.cadenceDays ? `Every ~${a.cadenceDays} days` : "—"}</TableCell>
                  <TableCell className="text-meta tabular-nums">
                    {a.lastEvent ? formatDate(a.lastEvent) : "—"}
                    {a.nextEvent ? (
                      <span className="text-fg-subtle inline-flex items-center gap-1">
                        {" · "}
                        <CalendarClock className="size-3" aria-hidden /> {formatDate(a.nextEvent)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
