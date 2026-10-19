import "server-only";

import type { Member } from "@/lib/auth/session";
import { dataSource, listApprovalChain, listApprovals } from "@/lib/data";
import { dispatchBookingConfirmed } from "@/lib/finance/export-dispatcher";
import { calculateGst } from "@/lib/gst-engine";
import { settleDeposit } from "@/lib/payments/service";
import { depositFor } from "@/lib/quotes";
import { depositRateFor } from "@/lib/rates/venue-pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BookingInvoiceRow, ContractEventRow, ContractRow, ContractSignatureRow, Json } from "@/lib/supabase/database.types";
import { getVenuePricing } from "@/lib/venues/pricing-store";
import { parseCancellationTerms } from "@/lib/venues/profile";
import { cancelSignatureRequest, getSignatureRequest, sendSignatureRequest, updatesFrom, type CallbackEvent } from "./dropboxSign";
import { afterSignature, canViewContract, canVoid, isOpen, issueRefusal, signingParty, type ContractParty, type ContractStatus } from "./lifecycle";
import { renderContract } from "./render";
import { describeSchedule, planInstalments } from "./schedule";
import { buildContractTerms, istDate, type ContractTerms } from "./terms";

/**
 * Contracts (migration 0031): issuing one from a booking's negotiated terms,
 * signing (in-app, or through Dropbox Sign), voiding, and what execution sets
 * off: the booking is confirmed by the countersignature trigger; then the
 * expense export, the deposit capture and the instalment invoices run here.
 * Those post-execution steps are idempotent and retried by the daily billing
 * cron, so a failure after the signature never loses them.
 *
 * Supabase only. Writes use the service role after the checks in lifecycle.ts.
 */

export class ContractError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "ContractError";
  }
}

const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";
export const CONTRACTS_UNAVAILABLE = "Contracts need Supabase with database migration 0031 (contracts and invoicing). Ask an admin to apply it.";

function db() {
  if (dataSource() !== "supabase") throw new ContractError(CONTRACTS_UNAVAILABLE, 503);
  return createAdminClient();
}

/** Postgres refusals written for people (23514 with a contract hint) become ContractErrors. */
function refusal(error: { code?: string; message: string; hint?: string } | null): never {
  if (isMissingTable(error)) throw new ContractError(CONTRACTS_UNAVAILABLE, 503);
  if (error?.code === "23514" || error?.code === "23505") throw new ContractError(error.code === "23505" ? "This booking already has a live contract." : error.message, 409);
  throw error;
}

export type SigningProviderName = "in_app" | "dropbox_sign";

/** Dropbox Sign when CONTRACT_SIGNING_PROVIDER=dropbox_sign and its API key are set; otherwise in-app signing. */
export function signingProvider(): SigningProviderName {
  return process.env.CONTRACT_SIGNING_PROVIDER === "dropbox_sign" && process.env.DROPBOX_SIGN_API_KEY ? "dropbox_sign" : "in_app";
}

async function audit(contractId: string, action: string, actor: Pick<Member, "userId" | "role"> | null, detail: Record<string, unknown> = {}) {
  const { error } = await createAdminClient()
    .from("contract_events")
    .insert({ contract_id: contractId, action, actor_user_id: actor?.userId ?? null, actor_role: actor?.role ?? "system", detail: detail as Json });
  if (error) console.error(`contracts: audit ${action} failed`, error);
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export interface ContractBundle {
  contract: ContractRow & { status: ContractStatus };
  terms: ContractTerms;
  signatures: ContractSignatureRow[];
  events: ContractEventRow[];
  invoices: BookingInvoiceRow[];
  booking: { id: string; status: string; company_id: string; venue_id: string; event_date: string };
}

/** A contract with its signatures, audit trail and invoices, if the member may see it. */
export async function getContractBundle(contractId: string, member: Member): Promise<ContractBundle | null> {
  const client = db();
  const { data: contract, error } = await client.from("contracts").select("*").eq("id", contractId).maybeSingle();
  if (isMissingTable(error)) throw new ContractError(CONTRACTS_UNAVAILABLE, 503);
  if (error) throw error;
  if (!contract || !canViewContract(member, contract)) return null;
  const [signatures, events, invoices, booking] = await Promise.all([
    client.from("contract_signatures").select("*").eq("contract_id", contractId).order("signed_at"),
    client.from("contract_events").select("*").eq("contract_id", contractId).order("at"),
    client.from("booking_invoices").select("*").eq("booking_id", contract.booking_id).order("sequence"),
    client.from("bookings").select("id, status, company_id, venue_id, event_date").eq("id", contract.booking_id).single(),
  ]);
  for (const r of [signatures, events, invoices, booking]) if (r.error) throw r.error;
  return {
    contract: contract as ContractBundle["contract"],
    terms: contract.terms as unknown as ContractTerms,
    signatures: signatures.data!,
    events: events.data!,
    invoices: invoices.data!.filter((i) => i.contract_id === contractId),
    booking: booking.data!,
  };
}

export interface ContractSummary {
  id: string;
  status: ContractStatus;
  revision: number;
}

/** The latest contract per booking (live first), for portal links. Empty without Supabase or the migration. */
export async function contractsForBookings(bookingIds: string[]): Promise<Map<string, ContractSummary>> {
  const out = new Map<string, ContractSummary>();
  if (dataSource() !== "supabase" || bookingIds.length === 0) return out;
  const { data, error } = await createAdminClient().from("contracts").select("id, booking_id, status, revision").in("booking_id", bookingIds).order("revision");
  if (isMissingTable(error)) return out;
  if (error) throw error;
  for (const c of data) out.set(c.booking_id, { id: c.id, status: c.status as ContractStatus, revision: c.revision });
  return out;
}

/** Whether the company confirms bookings by contract. False without Supabase or the migration. */
export async function contractsRequired(companyId: string): Promise<boolean> {
  if (dataSource() !== "supabase") return false;
  const { data, error } = await createAdminClient().from("companies").select("contracts_required").eq("id", companyId).maybeSingle();
  if (error) return false;
  return Boolean(data?.contracts_required);
}

/** Whether this booking's company confirms by contract. */
export async function contractRequiredForBooking(bookingId: string): Promise<boolean> {
  if (dataSource() !== "supabase") return false;
  const { data, error } = await createAdminClient().from("bookings").select("company:companies(contracts_required)").eq("id", bookingId).maybeSingle();
  if (error) return false;
  return Boolean((data?.company as { contracts_required?: boolean } | null)?.contracts_required);
}

export async function setContractsRequired(companyId: string, required: boolean): Promise<void> {
  const { error } = await db().from("companies").update({ contracts_required: required }).eq("id", companyId);
  if (error) refusal(error);
}

// ----------------------------------------------------------------------------
// Issuing
// ----------------------------------------------------------------------------

async function emailsOf(userIds: string[]): Promise<Map<string, string>> {
  const wanted = new Set(userIds);
  const out = new Map<string, string>();
  for (let page = 1; out.size < wanted.size && page <= 20; page++) {
    const { data, error } = await createAdminClient().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (wanted.has(u.id) && u.email) out.set(u.id, u.email);
    if (data.users.length < 1000) break;
  }
  return out;
}

/** The client's signatory (the issuer if an Approver, else tier 1) and the venue's first manager, for Dropbox Sign. */
async function providerSigners(member: Member, tenantId: string, venueId: string): Promise<{ name: string; email: string }[]> {
  const chain = await listApprovalChain(tenantId);
  const clientSigner = member.role === "CLIENT" && member.corporateRole === "APPROVER" ? member.userId : chain[0]?.approver_user_id;
  const { data: managers, error } = await createAdminClient().from("platform_users").select("user_id").eq("role", "PROPERTY").eq("venue_id", venueId).limit(1);
  if (error) throw error;
  const venueSigner = managers[0]?.user_id;
  if (!clientSigner) throw new ContractError("The company has no Approver to sign. Add one on Governance first.");
  if (!venueSigner) throw new ContractError("The venue has no manager account to countersign.");
  const emails = await emailsOf([clientSigner, venueSigner]);
  const pick = (id: string) => {
    const email = emails.get(id);
    if (!email) throw new ContractError("A signer has no email address on their account.");
    return { name: email.split("@")[0], email };
  };
  return [pick(clientSigner), pick(venueSigner)];
}

/** The deposit already authorised or captured before the contract (the pre-confirmation checkout), if any. */
async function liveDeposit(bookingId: string) {
  const { data, error } = await createAdminClient()
    .from("payments")
    .select("id, amount_inr, status")
    .eq("booking_id", bookingId)
    .is("booking_invoice_id", null)
    .in("status", ["authorized", "captured"])
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Generates the booking's contract from its current terms and sends it for signature. */
export async function issueContract(bookingId: string, member: Member): Promise<ContractRow> {
  const client = db();
  const { data: booking, error } = await client
    .from("bookings")
    .select("*, company:companies(legal_name, gstin, primary_contact_email), venue:venues(name, neighborhood, city, address, gstin, min_spend_inr, min_spend_per_head_inr, cancellation_terms)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) throw new ContractError("Booking not found.", 404);

  const { data: existing, error: existingError } = await client.from("contracts").select("status, revision").eq("booking_id", bookingId);
  if (existingError) refusal(existingError);
  const refusalReason = issueRefusal(member, booking, existing.some((c) => isOpen(c.status as ContractStatus) || c.status === "executed"));
  if (refusalReason) throw new ContractError(refusalReason, refusalReason.startsWith("Only") ? 403 : 409);

  const [approvals, pricing, deposit, department, allocation] = await Promise.all([
    listApprovals({ tenantId: booking.company_id }).then((rows) => rows.filter((a) => a.booking_id === bookingId)),
    getVenuePricing(booking.venue_id),
    liveDeposit(bookingId),
    booking.department_id ? client.from("departments").select("name").eq("id", booking.department_id).maybeSingle() : Promise.resolve({ data: null }),
    client.from("po_allocations").select("purchase_orders(po_number)").eq("booking_id", bookingId).neq("status", "released").maybeSingle(),
  ]);

  const invoice = calculateGst({
    total_amount: Number(booking.total_amount_inr),
    company_gstin: booking.billing_gstin ?? booking.company!.gstin,
    venue_gstin: booking.venue!.gstin,
    booking_id: booking.id,
    invoice_date: booking.event_date,
  });
  const depositRate = depositRateFor(pricing.pricing);
  const now = new Date();
  const instalments = planInstalments({
    invoice: { taxable: invoice.taxable_value, cgst: invoice.tax_breakup.cgst.amount, sgst: invoice.tax_breakup.sgst.amount, igst: invoice.tax_breakup.igst.amount, total: invoice.invoice_total },
    depositRate,
    eventDate: booking.event_date,
    today: istDate(now),
    depositInr: deposit ? Number(deposit.amount_inr) : depositFor(invoice.invoice_total, depositRate),
  });
  const revision = existing.reduce((n, c) => Math.max(n, c.revision), 0) + 1;
  const po = (allocation.data as { purchase_orders: { po_number: string } | null } | null)?.purchase_orders ?? null;
  const terms = buildContractTerms({
    booking: {
      ...booking,
      budget_per_head_inr: Number(booking.budget_per_head_inr),
      list_budget_per_head_inr: booking.list_budget_per_head_inr === null ? null : Number(booking.list_budget_per_head_inr),
      total_amount_inr: Number(booking.total_amount_inr),
    },
    company: booking.company!,
    venue: { ...booking.venue!, min_spend_inr: Number(booking.venue!.min_spend_inr), min_spend_per_head_inr: Number(booking.venue!.min_spend_per_head_inr) },
    invoice,
    cancellation: parseCancellationTerms(booking.venue!.cancellation_terms),
    depositRate,
    instalments: describeSchedule(instalments),
    department: department.data?.name ?? null,
    poNumber: po?.po_number ?? null,
    approvals: approvals.map((a) => ({ step: a.step, approverName: a.approver_name, status: a.status, decidedAt: a.decided_at, note: a.decision_note, escalatedFrom: a.escalated_from })),
    approvalReason: approvals[0]?.reason ?? null,
    revision,
    issuedAt: now,
  });
  const doc = renderContract(terms);
  const provider = signingProvider();
  // Resolve Dropbox Sign signers before inserting, so a missing signer leaves nothing behind.
  const signers = provider === "dropbox_sign" ? await providerSigners(member, booking.company_id, booking.venue_id) : null;

  const { data: contract, error: insertError } = await client
    .from("contracts")
    .insert({
      tenant_id: booking.company_id,
      booking_id: bookingId,
      venue_id: booking.venue_id,
      revision,
      template_key: doc.template.key,
      template_version: doc.template.version,
      terms: terms as unknown as Json,
      document_html: doc.html,
      document_sha256: doc.sha256,
      provider,
      issued_by: member.userId,
    })
    .select("*")
    .single();
  if (insertError) refusal(insertError);
  await audit(contract.id, "issued", member, { revision, document_sha256: doc.sha256, provider });

  if (signers) {
    try {
      const sent = await sendSignatureRequest({
        apiKey: process.env.DROPBOX_SIGN_API_KEY!,
        title: `Venue Services Agreement ${terms.contractNumber}`,
        subject: `Please sign: ${terms.venue.name} on ${terms.event.date}`,
        message: `${terms.client.legalName} and ${terms.venue.name}: the client signs first, then the venue countersigns.`,
        signers,
        fileName: `${terms.contractNumber}.html`,
        html: doc.html,
        contractId: contract.id,
        testMode: process.env.DROPBOX_SIGN_TEST_MODE !== "0",
      });
      const { error: e } = await client.from("contracts").update({ provider_request_id: sent.requestId }).eq("id", contract.id);
      if (e) throw e;
      await audit(contract.id, "sent_to_provider", member, { request_id: sent.requestId, signers: signers.map((s) => s.email) });
      return { ...contract, provider_request_id: sent.requestId };
    } catch (err) {
      await client.from("contracts").update({ status: "voided", close_reason: "Could not be sent to Dropbox Sign" }).eq("id", contract.id);
      await audit(contract.id, "voided", null, { reason: err instanceof Error ? err.message : String(err) });
      throw new ContractError("The contract couldn't be sent to Dropbox Sign. Try again shortly.", 502);
    }
  }
  return contract;
}

// ----------------------------------------------------------------------------
// Signing, declining, voiding
// ----------------------------------------------------------------------------

export interface SignatureInput {
  name: string;
  title?: string | null;
  /** The document hash the signer was shown: refused if the contract changed underneath them. */
  documentSha256: string;
  consent: boolean;
  ip: string | null;
  userAgent: string | null;
}

/** An in-app signature. The countersignature executes the contract (and confirms the booking) in the same insert. */
export async function signContract(contractId: string, member: Member, input: SignatureInput): Promise<ContractStatus> {
  const client = db();
  const { data: contract, error } = await client.from("contracts").select("*").eq("id", contractId).maybeSingle();
  if (error) refusal(error);
  if (!contract || !canViewContract(member, contract)) throw new ContractError("Contract not found.", 404);
  if (contract.provider !== "in_app") throw new ContractError("This contract is signed through Dropbox Sign. Use the link in your email.", 409);
  const who = signingParty(member, { ...contract, status: contract.status as ContractStatus });
  if (!who.ok) throw new ContractError(who.reason, 403);
  if (!input.consent) throw new ContractError("Tick the box to agree to sign electronically.");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new ContractError("Type your full name to sign.");
  if (input.documentSha256 !== contract.document_sha256) throw new ContractError("The contract changed since you opened it. Reload and review it again.", 409);

  const { error: signError } = await client.from("contract_signatures").insert({
    contract_id: contractId,
    party: who.party,
    signer_user_id: member.userId,
    signer_name: name,
    signer_title: input.title?.trim().slice(0, 120) || null,
    signer_email: member.email,
    document_sha256: input.documentSha256,
    ip_address: input.ip?.slice(0, 64) ?? null,
    user_agent: input.userAgent?.slice(0, 500) ?? null,
  });
  if (signError) refusal(signError);
  const next = afterSignature(contract.status as ContractStatus, who.party);
  const status = next.ok ? next.status : (contract.status as ContractStatus);
  if (status === "executed") await afterExecution(contractId);
  return status;
}

/** The awaited signer declines; the booking stays with the venue until a new revision is signed or it's cancelled. */
export async function declineContract(contractId: string, member: Member, reason: string): Promise<void> {
  const client = db();
  const { data: contract, error } = await client.from("contracts").select("*").eq("id", contractId).maybeSingle();
  if (error) refusal(error);
  if (!contract || !canViewContract(member, contract)) throw new ContractError("Contract not found.", 404);
  const who = signingParty(member, { ...contract, status: contract.status as ContractStatus });
  if (!who.ok) throw new ContractError(who.reason, 403);
  const note = reason.trim().slice(0, 500) || "Declined without a reason";
  const { error: e } = await client.from("contracts").update({ status: "declined", close_reason: note }).eq("id", contractId);
  if (e) refusal(e);
  await audit(contractId, "declined", member, { party: who.party, reason: note });
  if (contract.provider === "dropbox_sign" && contract.provider_request_id) {
    await cancelSignatureRequest(process.env.DROPBOX_SIGN_API_KEY ?? "", contract.provider_request_id).catch((err) => console.error("contracts: cancel at Dropbox Sign failed", err));
  }
}

/** Withdraws an unsigned (or half-signed) contract, so a corrected revision can be issued. */
export async function voidContract(contractId: string, member: Member, reason: string): Promise<void> {
  const client = db();
  const { data: contract, error } = await client.from("contracts").select("*").eq("id", contractId).maybeSingle();
  if (error) refusal(error);
  if (!contract || !canViewContract(member, contract)) throw new ContractError("Contract not found.", 404);
  if (!canVoid(member, { ...contract, status: contract.status as ContractStatus })) throw new ContractError("Only an open contract can be voided, by its company's Approvers, its venue or an admin.", 403);
  const note = reason.trim().slice(0, 500) || "Voided";
  const { error: e } = await client.from("contracts").update({ status: "voided", close_reason: note }).eq("id", contractId);
  if (e) refusal(e);
  await audit(contractId, "voided", member, { reason: note });
  if (contract.provider === "dropbox_sign" && contract.provider_request_id) {
    await cancelSignatureRequest(process.env.DROPBOX_SIGN_API_KEY ?? "", contract.provider_request_id).catch((err) => console.error("contracts: cancel at Dropbox Sign failed", err));
  }
}

/** Records that a party opened the contract (once per member). */
export async function recordView(bundle: ContractBundle, member: Member): Promise<void> {
  if (bundle.events.some((e) => e.action === "viewed" && e.actor_user_id === member.userId)) return;
  await audit(bundle.contract.id, "viewed", member);
}

// ----------------------------------------------------------------------------
// After execution: expense export, deposit capture, instalment invoices
// ----------------------------------------------------------------------------

/**
 * Idempotent. The countersignature already confirmed the booking (and so converted its
 * hold and committed its PO and budget holds); this does what the venue's Confirm used
 * to do around it, then schedules the invoices. Failures are logged on the contract and
 * retried by the billing cron.
 */
export async function afterExecution(contractId: string): Promise<void> {
  const client = createAdminClient();
  try {
    const { data: contract, error } = await client.from("contracts").select("id, booking_id, tenant_id, venue_id, status, terms, executed_at").eq("id", contractId).single();
    if (error) throw error;
    if (contract.status !== "executed") return;
    const { data: existing, error: invError } = await client.from("booking_invoices").select("id").eq("contract_id", contractId);
    if (invError) throw invError;

    if (existing.length === 0) {
      const terms = contract.terms as unknown as ContractTerms;
      const deposit = await liveDeposit(contract.booking_id);
      const today = istDate(new Date(contract.executed_at!));
      const plan = planInstalments({
        invoice: { taxable: terms.pricing.taxable, cgst: terms.pricing.cgst, sgst: terms.pricing.sgst, igst: terms.pricing.igst, total: terms.pricing.invoiceTotal },
        depositRate: terms.payment.depositRate,
        eventDate: terms.event.date,
        today,
        depositInr: terms.payment.instalments.find((i) => i.kind === "deposit")?.total,
      });
      const gst = { supplier_gstin: terms.venue.gstin, recipient_gstin: terms.client.billingGstin ?? terms.client.gstin, gst_type: terms.pricing.gstType, sac: terms.pricing.sacCode, rate_percent: terms.pricing.gstRatePercent, contract: terms.contractNumber };
      const { error: insertError } = await client.from("booking_invoices").insert(
        plan.map((i) => ({
          tenant_id: contract.tenant_id,
          booking_id: contract.booking_id,
          contract_id: contractId,
          venue_id: contract.venue_id,
          kind: i.kind,
          sequence: i.sequence,
          taxable_inr: i.taxable,
          cgst_inr: i.cgst,
          sgst_inr: i.sgst,
          igst_inr: i.igst,
          total_inr: i.total,
          gst: { ...gst, kind: i.kind } as Json,
          issue_on: i.issueOn,
          due_on: i.dueOn,
          // The deposit invoice is issued on execution; a deposit paid before the contract settles it.
          status: i.issueOn <= today ? (i.kind === "deposit" && deposit?.status === "captured" ? "paid" : "issued") : "scheduled",
          payment_id: i.kind === "deposit" ? (deposit?.id ?? null) : null,
        }))
      );
      // 23505: a concurrent run scheduled them first.
      if (insertError && insertError.code !== "23505") throw insertError;
      if (!insertError) await audit(contractId, "invoices_scheduled", null, { instalments: plan.map((i) => ({ kind: i.kind, total: i.total, due_on: i.dueOn })) });
    }

    // What the venue's Confirm did besides the status change (lib/bookings/confirm.ts).
    await dispatchBookingConfirmed(contract.booking_id);
    await settleDeposit(contract.booking_id, "capture");
  } catch (err) {
    console.error(`contracts: post-execution steps failed for ${contractId}`, err);
    await audit(contractId, "post_execution_failed", null, { error: err instanceof Error ? err.message : String(err) });
  }
}

// ----------------------------------------------------------------------------
// Provider callbacks (app/api/contracts/webhooks/[provider])
// ----------------------------------------------------------------------------

/**
 * Applies a verified Dropbox Sign callback. Idempotent on the event id. Acts on the
 * signature request as the API reports it, not the callback body.
 */
export async function applyProviderCallback(event: CallbackEvent, opts: { fetch?: typeof fetch } = {}): Promise<"applied" | "duplicate" | "ignored"> {
  const client = createAdminClient();
  const { data: seen } = await client.from("contract_webhook_events").select("event_id").eq("provider", "dropbox_sign").eq("event_id", event.eventId).maybeSingle();
  if (seen) return "duplicate";

  let outcome: "applied" | "ignored" = "ignored";
  if (event.requestId && event.kind !== "test" && event.kind !== "other") {
    const { data: contract, error } = await client.from("contracts").select("*").eq("provider", "dropbox_sign").eq("provider_request_id", event.requestId).maybeSingle();
    if (error) throw error;
    if (contract) {
      const request = await getSignatureRequest(process.env.DROPBOX_SIGN_API_KEY ?? "", event.requestId, opts.fetch);
      const { data: signed } = await client.from("contract_signatures").select("party").eq("contract_id", contract.id);
      for (const update of updatesFrom(request, (signed ?? []).map((s) => s.party as ContractParty), event)) {
        if (update.kind === "sign") {
          const { error: e } = await client.from("contract_signatures").insert({
            contract_id: contract.id,
            party: update.party,
            signer_name: update.signature.name,
            signer_email: update.signature.email,
            document_sha256: contract.document_sha256,
            provider_signature_id: update.signature.signatureId,
          });
          if (e && e.code !== "23505") throw e;
        } else {
          const status = update.kind === "decline" ? "declined" : "voided";
          const reason = update.kind === "decline" ? `Declined by ${update.signer} on Dropbox Sign` : "Cancelled on Dropbox Sign";
          const { error: e } = await client.from("contracts").update({ status, close_reason: reason }).eq("id", contract.id).in("status", ["awaiting_client", "awaiting_venue"]);
          if (e) throw e;
        }
        outcome = "applied";
      }
      await audit(contract.id, "provider_callback", null, { event: event.type, applied: outcome === "applied" });
      const { data: after } = await client.from("contracts").select("status").eq("id", contract.id).single();
      if (after?.status === "executed") await afterExecution(contract.id);
    }
  }

  // Recorded after applying, so a failed apply is retried by the provider.
  const { error: recordError } = await client.from("contract_webhook_events").insert({ provider: "dropbox_sign", event_id: event.eventId, event_type: event.type, payload: event.payload as Json });
  if (recordError && recordError.code !== "23505") throw recordError;
  return outcome;
}

// ----------------------------------------------------------------------------
// Billing cron (app/api/cron/issue-invoices)
// ----------------------------------------------------------------------------

/** Issues instalments whose day has come and retries post-execution steps that didn't finish. */
export async function runBillingSweep(now = new Date()): Promise<{ issued: number; reconciled: number }> {
  const client = createAdminClient();
  const today = istDate(now);
  const { data: due, error } = await client.from("booking_invoices").update({ status: "issued" }).eq("status", "scheduled").lte("issue_on", today).select("id");
  if (isMissingTable(error)) return { issued: 0, reconciled: 0 };
  if (error) throw error;

  const { data: executed, error: e2 } = await client.from("contracts").select("id, booking_invoices(id)").eq("status", "executed").gte("executed_at", new Date(now.getTime() - 30 * 86_400_000).toISOString());
  if (e2) throw e2;
  const missing = (executed as { id: string; booking_invoices: { id: string }[] }[]).filter((c) => c.booking_invoices.length === 0);
  for (const c of missing) await afterExecution(c.id);
  return { issued: due.length, reconciled: missing.length };
}
