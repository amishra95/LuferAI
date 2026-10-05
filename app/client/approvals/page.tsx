import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, CircleX, ClipboardCheck } from "lucide-react";

import { PendingApprovalPill, RateCardPill } from "@/components/portal/pills";
import { PortalShell } from "@/components/portal/portal-shell";
import { GstTypeBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { approvalItemisation, approvalQueue, type ApprovalItemisation } from "@/lib/approvals/service";
import { requirePortal } from "@/lib/auth/session";
import { listCompanies } from "@/lib/data";
import { roundInr } from "@/lib/gst-engine";
import { DEPOSIT_RATE, depositFor } from "@/lib/quotes";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { ApprovalDecisionForm } from "../_components/approval-decision-form";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: PageProps<"/client/approvals">) {
  const member = await requirePortal("/client");
  const { id, company: companyParam } = await searchParams;

  const all = await listCompanies();
  const companies = member.role === "ADMIN" ? all : all.filter((c) => c.id === member.companyId);
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  if (member.role !== "ADMIN" && !member.canApprove) {
    return (
      <PortalShell portal="/client/approvals" title="Approvals" subtitle="Bookings outside company policy">
        <div className="glass mx-auto grid max-w-md justify-items-center gap-3 rounded-2xl p-8 text-center">
          <ClipboardCheck className="size-6 text-zinc-400" aria-hidden />
          <p className="text-sm text-zinc-300">
            You&apos;re not on {company.legal_name.replace(" Private Limited", "")}&apos;s approval chain. Ask a platform
            admin to add you as an approver.
          </p>
          <Button asChild variant="outline">
            <Link href="/client">Back to bookings</Link>
          </Button>
        </div>
      </PortalShell>
    );
  }

  const queue = await approvalQueue(member, company.id);
  const selected = typeof id === "string" ? queue.find((a) => a.id === id) ?? null : null;
  const detail = selected ? await approvalItemisation(selected, company.id) : null;
  const companyQs = member.role === "ADMIN" ? `company=${company.id}` : "";
  const hrefFor = (approvalId: string) => `/client/approvals?${[`id=${approvalId}`, companyQs].filter(Boolean).join("&")}`;

  return (
    <PortalShell
      portal="/client/approvals"
      title="Approvals"
      subtitle={`${company.legal_name.replace(" Private Limited", "")} · ${queue.length} request${queue.length === 1 ? "" : "s"} awaiting your sign-off`}
    >
      <div className="grid overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Queue */}
        <section aria-label="Pending approvals" className={cn("lg:border-r lg:border-zinc-800/60", detail && "max-lg:hidden")}>
          {queue.length === 0 ? (
            <div className="grid min-h-64 place-items-center p-8 text-center text-sm text-zinc-400">
              <div className="grid justify-items-center gap-2">
                <CircleCheck className="size-6 text-emerald-300" aria-hidden />
                Nothing waiting for you.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {queue.map((a) => (
                <li key={a.id}>
                  <Link
                    href={hrefFor(a.id)}
                    aria-current={a.id === selected?.id ? "true" : undefined}
                    className={cn(
                      "grid min-h-11 gap-1.5 px-4 py-4 transition hover:bg-zinc-800/40",
                      a.id === selected?.id && "bg-zinc-800/70 shadow-[inset_3px_0_0] shadow-amber-400"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-50">{a.booking.venue_name}</div>
                        <div className="text-sm text-zinc-400">
                          {formatDate(a.booking.event_date)} · {a.booking.party_size} guests
                        </div>
                      </div>
                      <div className="shrink-0 text-right font-medium text-zinc-50 tabular-nums">
                        {formatINR(a.booking.total_amount_inr)}
                      </div>
                    </div>
                    <div className="text-xs text-zinc-500">
                      Requested by {a.requester_name} · {formatDate(a.created_at.slice(0, 10))}
                    </div>
                    {a.reason ? <p className="line-clamp-2 text-xs text-red-200">{a.reason}</p> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Itemisation */}
        <section aria-label="Approval detail" className={cn("min-h-64", !detail && "max-lg:hidden")}>
          {!detail ? (
            <div className="grid h-full min-h-64 place-items-center p-8 text-sm text-zinc-500">
              Select a request to review its GST and policy breakdown.
            </div>
          ) : (
            <ApprovalDetailPane detail={detail} backHref={`/client/approvals${companyQs ? `?${companyQs}` : ""}`} />
          )}
        </section>
      </div>
    </PortalShell>
  );
}

function ApprovalDetailPane({ detail: { approval, booking: b, checks, department }, backHref }: { detail: ApprovalItemisation; backHref: string }) {
  const inv = b.invoice;
  const listPerHead = b.list_budget_per_head_inr != null ? Number(b.list_budget_per_head_inr) : null;
  const list = roundInr(b.party_size * (listPerHead ?? b.budget_per_head_inr));
  const savings = roundInr(Math.max(0, list - inv.taxable_value));
  const deposit = depositFor(inv.invoice_total);

  const lines: { label: string; value: string; strong?: boolean; muted?: boolean }[] = [
    { label: `Menu · ${b.party_size} × ${formatINR(listPerHead ?? b.budget_per_head_inr, true)}`, value: formatINR(list, true) },
    ...(savings > 0 ? [{ label: "Corporate rate card", value: `−${formatINR(savings, true)}`, muted: true }] : []),
    { label: "Taxable value · SAC 998596", value: formatINR(inv.taxable_value, true) },
    ...(inv.gst_type === "IGST"
      ? [{ label: "IGST 18%", value: formatINR(inv.tax_breakup.igst.amount, true) }]
      : [
          { label: "CGST 9%", value: formatINR(inv.tax_breakup.cgst.amount, true) },
          { label: "SGST 9%", value: formatINR(inv.tax_breakup.sgst.amount, true) },
        ]),
    { label: "Invoice total", value: formatINR(inv.invoice_total, true), strong: true },
    { label: `Deposit once approved (${Math.round(DEPOSIT_RATE * 100)}%)`, value: formatINR(deposit, true), muted: true },
    { label: "Input tax credit claimable", value: formatINR(inv.itc_eligible_amount, true), muted: true },
  ];

  return (
    <div className="grid gap-6 p-4 sm:p-6">
      <div>
        <Link href={backHref} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100 lg:hidden">
          <ArrowLeft className="size-4" aria-hidden /> All requests
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-zinc-50">{b.venue.name}</h2>
          <PendingApprovalPill />
          {savings > 0 ? <RateCardPill label={`−${formatINR(savings)}`} /> : null}
          <GstTypeBadge type={inv.gst_type} />
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          {formatDate(b.event_date)} · {b.party_size} guests · {b.venue.neighborhood} · requested by {approval.requester_name}
        </p>
        {b.notes ? <p className="mt-2 text-sm text-zinc-300">“{b.notes}”</p> : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-300">GST itemisation</h3>
        <dl className="divide-y divide-zinc-800/60 rounded-xl border border-zinc-800/60 bg-zinc-950/40">
          {lines.map((l) => (
            <div key={l.label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className={l.muted ? "text-zinc-500" : l.strong ? "font-medium text-zinc-50" : "text-zinc-300"}>{l.label}</dt>
              <dd className={cn("tabular-nums", l.strong ? "font-semibold text-zinc-50" : l.muted ? "text-zinc-400" : "text-zinc-100")}>
                {l.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-zinc-500">
          Supplier {inv.supplier.gstin} ({inv.supplier.state_name}) → recipient {inv.recipient.gstin} · place of supply{" "}
          {inv.place_of_supply.state_name}
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-300">Policy checks</h3>
        <ul className="grid gap-2">
          {checks.map((c) => (
            <li
              key={c.rule}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
                c.ok ? "border-zinc-800/60 bg-zinc-950/30" : "border-red-400/30 bg-red-400/5"
              )}
            >
              {c.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-label="Pass" />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0 text-red-300" aria-label="Breach" />
              )}
              <div>
                <div className={c.ok ? "text-zinc-200" : "font-medium text-red-100"}>{c.label}</div>
                <div className="text-xs text-zinc-400 tabular-nums">{c.detail}</div>
              </div>
            </li>
          ))}
          {department ? (
            <li className="flex items-start gap-3 rounded-lg border border-zinc-800/60 bg-zinc-950/30 px-3 py-2.5 text-sm">
              <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />
              <div>
                <div className="text-zinc-200">{department.name} budget (for reference)</div>
                <div className="text-xs text-zinc-400 tabular-nums">
                  {formatINR(roundInr(department.fyCommittedInr + inv.taxable_value))} of {formatINR(department.annual_budget_inr)} this FY
                  with this booking
                </div>
              </div>
            </li>
          ) : null}
        </ul>
      </div>

      <ApprovalDecisionForm
        approvalId={approval.id}
        className="glass sticky bottom-[calc(4.5rem+var(--app-safe-bottom))] grid gap-3 rounded-xl p-3 md:bottom-4"
      />
    </div>
  );
}
