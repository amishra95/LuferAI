import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Printer } from "lucide-react";

import { NoticePill, Page, PageHeader, SectionLabel } from "@/components/dashboard/page-header";
import { IssueContractButton, SignPanel, VoidContractButton } from "@/components/contracts/contract-actions";
import { Pill, type PillTone } from "@/components/portal/pills";
import { requireWorkspace } from "@/lib/auth/session";
import { paymentsEnabled } from "@/lib/payments/service";
import { getContractBundle, recordView } from "@/lib/services/contracts/contractStore";
import { awaitedParty, canVoid, signingParty, STATUS_LABEL, type ContractStatus } from "@/lib/services/contracts/lifecycle";
import { payability } from "@/lib/services/contracts/schedule";
import { formatDate, formatINR } from "@/lib/utils";
import { PayDepositButton } from "../../client/_components/pay-deposit-button";

export const metadata: Metadata = { title: "Contract" };

const TONE: Record<ContractStatus, PillTone> = { awaiting_client: "warn", awaiting_venue: "warn", executed: "ok", declined: "error", voided: "neutral" };
const INVOICE_TONE: Record<string, PillTone> = { scheduled: "neutral", issued: "warn", paid: "ok", void: "neutral" };

const EVENT_LABEL: Record<string, string> = {
  issued: "Issued",
  sent_to_provider: "Sent to Dropbox Sign",
  viewed: "Opened",
  client_signed: "Signed by the client",
  executed: "Countersigned by the venue: executed",
  declined: "Declined",
  voided: "Voided",
  provider_callback: "Dropbox Sign update",
  invoices_scheduled: "Invoices scheduled",
  post_execution_failed: "Follow-up after execution failed (retried daily)",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function ContractPage({ params, searchParams }: PageProps<"/contracts/[id]">) {
  const member = await requireWorkspace("/contracts");
  const { id } = await params;
  const { payment } = await searchParams;
  const bundle = await getContractBundle(id, member);
  if (!bundle) notFound();
  await recordView(bundle, member);

  const { contract, terms, signatures, events, invoices, booking } = bundle;
  const status = contract.status;
  const signer = contract.provider === "in_app" ? signingParty(member, contract) : null;
  const awaited = awaitedParty(status);
  const canPay = paymentsEnabled() && (member.role === "ADMIN" || (member.role === "CLIENT" && member.companyId === contract.tenant_id));
  const reissue = (status === "voided" || status === "declined") && booking.status === "PENDING";

  return (
    <Page>
      <PageHeader
        title={`Contract ${terms.contractNumber}`}
        description={`${terms.client.legalName} × ${terms.venue.name} · ${formatDate(terms.event.date)} · ${terms.event.partySize} guests · ${formatINR(terms.pricing.invoiceTotal, true)} incl. GST`}
        badge={
          <>
            <Pill tone={TONE[status]}>{STATUS_LABEL[status]}</Pill>
            {contract.provider === "dropbox_sign" ? <NoticePill>via Dropbox Sign</NoticePill> : null}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <a className="btn" href={`/api/contracts/${contract.id}/document`} target="_blank" rel="noopener">
              <Printer className="size-3.5" aria-hidden /> Print / PDF
            </a>
            <a className="btn" href={`/api/contracts/${contract.id}/document?download=1`}>
              <Download className="size-3.5" aria-hidden /> Download
            </a>
          </div>
        }
      />

      {payment === "success" ? <p className="text-sage mb-4 text-meta">Payment received. The invoice updates as soon as the payment provider confirms it.</p> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Agreement">
          {/* Our own static HTML, sandboxed with scripts off. */}
          <iframe srcDoc={contract.document_html} sandbox="" title={`Venue Services Agreement ${terms.contractNumber}`} className="border-line h-[75vh] w-full rounded-lg border bg-white" />
          <p className="text-fg-faint mt-2 font-mono text-caption break-all">
            Revision {contract.revision} · template {contract.template_key} v{contract.template_version} · SHA-256 {contract.document_sha256}
          </p>
        </section>

        <aside className="grid content-start gap-6">
          {signer?.ok ? (
            <SignPanel contractId={contract.id} documentSha256={contract.document_sha256} party={signer.party} defaultName="" />
          ) : awaited ? (
            <p className="panel text-fg-muted p-4 text-meta leading-5">
              {contract.provider === "dropbox_sign"
                ? `Waiting for the ${awaited === "client" ? "client's" : "venue's"} signature on Dropbox Sign (sent by email).`
                : signer && !signer.ok
                  ? signer.reason
                  : `Waiting for the ${awaited === "client" ? "client's Approver to sign" : "venue to countersign"}.`}
            </p>
          ) : status === "executed" ? (
            <p className="panel text-fg-muted p-4 text-meta leading-5">Executed {contract.executed_at ? when(contract.executed_at) : ""}. The booking is confirmed.</p>
          ) : (
            <div className="panel grid gap-3 p-4">
              <p className="text-fg-muted text-meta leading-5">
                {STATUS_LABEL[status]}
                {contract.close_reason ? `: ${contract.close_reason}` : ""}.
              </p>
              {reissue ? <IssueContractButton bookingId={booking.id} label="Issue a new revision" className="justify-self-start" /> : null}
            </div>
          )}
          {canVoid(member, contract) ? <VoidContractButton contractId={contract.id} /> : null}

          <section aria-labelledby="signatures-heading">
            <SectionLabel>
              <span id="signatures-heading">Signatures</span>
            </SectionLabel>
            <ul className="panel divide-line divide-y">
              {(["client", "venue"] as const).map((party) => {
                const s = signatures.find((x) => x.party === party);
                return (
                  <li key={party} className="grid gap-0.5 px-3 py-2.5 text-meta">
                    <span className="label-mono">{party === "client" ? terms.client.legalName : terms.venue.name}</span>
                    {s ? (
                      <span className="text-fg">
                        {s.signer_name}
                        {s.signer_title ? `, ${s.signer_title}` : ""} · {when(s.signed_at)}
                      </span>
                    ) : (
                      <span className="text-fg-faint">Not signed</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="invoices-heading">
            <SectionLabel>
              <span id="invoices-heading">Payment schedule</span>
            </SectionLabel>
            {invoices.length === 0 ? (
              <ul className="panel divide-line divide-y">
                {terms.payment.instalments.map((i) => (
                  <li key={i.kind} className="flex justify-between gap-3 px-3 py-2.5 text-meta">
                    <span className="text-fg-muted">{i.kind === "deposit" ? "Deposit, on execution" : `Balance, due ${formatDate(i.due)}`}</span>
                    <span className="figure text-fg">{formatINR(i.total, true)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="panel divide-line divide-y">
                {invoices.map((inv) => {
                  const pay = payability(inv);
                  return (
                    <li key={inv.id} className="grid gap-2 px-3 py-2.5 text-meta">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-fg font-medium capitalize">{inv.kind}</span>
                        {inv.invoice_number ? <span className="figure text-fg-subtle">{inv.invoice_number}</span> : null}
                        <Pill tone={INVOICE_TONE[inv.status] ?? "neutral"} className="ml-auto">
                          {inv.status === "scheduled" ? `Issues ${formatDate(inv.issue_on)}` : inv.status}
                        </Pill>
                      </div>
                      <div className="text-fg-subtle flex flex-wrap justify-between gap-2">
                        <span>
                          Taxable {formatINR(Number(inv.taxable_inr), true)} + GST {formatINR(Number(inv.cgst_inr) + Number(inv.sgst_inr) + Number(inv.igst_inr), true)} · due {formatDate(inv.due_on)}
                        </span>
                        <span className="figure text-fg">{formatINR(Number(inv.total_inr), true)}</span>
                      </div>
                      {canPay && pay.ok ? <PayDepositButton invoiceId={inv.id} label={`Pay ${formatINR(Number(inv.total_inr))}`} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="trail-heading">
            <SectionLabel>
              <span id="trail-heading">Audit trail</span>
            </SectionLabel>
            <ol className="border-line grid gap-1 border-l pl-3 text-caption">
              {events.map((e) => (
                <li key={e.id} className={e.action === "post_execution_failed" ? "text-rose" : "text-fg-subtle"}>
                  <time className="text-fg-faint mr-2 font-mono tabular-nums" dateTime={e.at}>
                    {when(e.at)}
                  </time>
                  {EVENT_LABEL[e.action] ?? e.action}
                  {e.actor_role && e.actor_role !== "system" ? <span className="text-fg-faint"> · {e.actor_role.toLowerCase()}</span> : null}
                </li>
              ))}
            </ol>
          </section>

          <Link href={member.role === "PROPERTY" ? "/property" : "/client"} className="text-fg-subtle hover:text-fg inline-flex items-center gap-1 text-meta">
            <ExternalLink className="size-3.5" aria-hidden /> Back to bookings
          </Link>
        </aside>
      </div>
    </Page>
  );
}
