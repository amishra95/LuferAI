import "server-only";

import { tool } from "ai";
import { z } from "zod";

import type { Member } from "@/lib/auth/session";
import { placeBookingRequest } from "@/lib/bookings/place-booking";
import { env } from "@/lib/channels/config";
import { postSlackMessage } from "@/lib/channels/slack";
import { listApprovals, listBookings } from "@/lib/data";
import { issueVirtualCard, VirtualCardError } from "@/lib/finance/virtual-cards";
import { checkBookingPolicy } from "@/lib/policies/checkBookingPolicy";
import { approvalDemand } from "@/lib/services/enterprise/approvalEngine";
import { checkGovernance } from "@/lib/services/enterprise/governanceStore";
import { ContractError, issueContract, signContract } from "@/lib/services/contracts/contractStore";
import type { ContractTerms } from "@/lib/services/contracts/terms";
import { formatINR } from "@/lib/utils";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const uuid = z.uuid();

/**
 * Returned by money-moving tools when the booking still needs internal sign-off.
 * The concierge route sees `needsApproval` and makes the next step call
 * sendSlackApprovalRequest (prepareStep in app/api/agent/chat/route.ts).
 */
export type NeedsApproval = { ok: false; needsApproval: true; bookingId: string; error: string };

export const needsApproval = (bookingId: string): NeedsApproval => ({
  ok: false,
  needsApproval: true,
  bookingId,
  error: "This booking is waiting for internal approval under company policy; nothing can be paid until it's approved.",
});

/** Pending sign-off for a booking of the member's company: the active step's approver and the reason. */
async function pendingApproval(companyId: string, bookingId: string) {
  const steps = (await listApprovals({ tenantId: companyId, status: "PENDING" })).filter((a) => a.booking_id === bookingId);
  const active = steps.find((a) => a.activated_at !== null) ?? steps[0];
  return active ? { approver: active.approver_name, reason: active.reason, remaining: steps.length, booking: active.booking } : null;
}

/** One reminder per booking per window, so a looping model can't spam the channel. */
const REMINDER_WINDOW_MS = 15 * 60_000;
const g = globalThis as typeof globalThis & { __luferApprovalPings?: Map<string, number> };
const lastPing = (g.__luferApprovalPings ??= new Map());

function contractSummary(t: ContractTerms) {
  return {
    contractNumber: t.contractNumber,
    revision: t.revision,
    parties: { client: t.client.legalName, venue: t.venue.legalName },
    event: { date: t.event.date, partySize: t.event.partySize, venue: `${t.venue.name}, ${t.venue.neighborhood}` },
    pricing: {
      perHeadInr: t.pricing.perHead,
      taxableInr: t.pricing.taxable,
      gst: { type: t.pricing.gstType, cgstInr: t.pricing.cgst, sgstInr: t.pricing.sgst, igstInr: t.pricing.igst, ratePercent: t.pricing.gstRatePercent, sac: t.pricing.sacCode },
      invoiceTotalInr: t.pricing.invoiceTotal,
    },
    minimumSpendGuaranteeInr: t.venueRules.minimumSpend,
    deposit: { ratePercent: Math.round(t.payment.depositRate * 100), instalments: t.payment.instalments },
    cancellation: t.venueRules.cancellation,
  };
}

/**
 * B2B tools for the concierge, bound to the signed-in member. Each one goes
 * through the existing engine (bookings, policy and approvals, cards,
 * contracts), which re-checks the member's company on every call.
 */
export function createEnterpriseTools({ member, origin }: { member: Member; origin: string }) {
  const companyId = member.companyId;
  const clientOnly = () => (companyId ? null : { ok: false as const, error: "Booking for a company needs a client account; admins act through the company's own users." });

  return {
    checkSpendPolicy: tool({
      description:
        "Check a proposed event against company and department spend policy, approval rules and team budgets before booking. " +
        "Returns whether sign-off is needed, why, and how many approval levels.",
      inputSchema: z.object({
        eventDate: isoDate,
        partySize: z.number().int().min(1).max(5000),
        perHeadInr: z.number().positive().max(1_000_000).describe("Price per guest, INR before GST."),
        departmentId: uuid.nullish(),
        alcoholIncluded: z.boolean().nullish(),
      }),
      execute: async ({ eventDate, partySize, perHeadInr, departmentId, alcoholIncluded }) => {
        const refused = clientOnly();
        if (refused) return refused;
        const total = Math.round(partySize * perHeadInr * 100) / 100;
        const [policy, governance] = await Promise.all([
          checkBookingPolicy({ tenant_id: companyId!, total_amount: total, headcount: partySize, per_head_amount: perHeadInr, event_date: eventDate, alcohol_included: alcoholIncluded ?? false, department_id: departmentId }),
          checkGovernance({ tenantId: companyId!, departmentId: departmentId ?? null, date: eventDate, amount: total }),
        ]);
        if (policy.blocked) return { ok: true as const, allowed: false, reason: policy.reason };
        if (governance.spend.kind === "blocked") return { ok: true as const, allowed: false, reason: governance.spend.reason };
        const demand = approvalDemand({ policy, amount: total, rule: governance.rule, budgetReason: governance.spend.kind === "over" ? governance.spend.reason : null, extraReasons: [] });
        return {
          ok: true as const,
          allowed: true,
          totalPreGstInr: total,
          requiresApproval: demand.required,
          ...(demand.required && { approvalLevels: demand.levels, reasons: demand.reasons }),
        };
      },
    }),

    requestVenuePartnerBooking: tool({
      description:
        "Send a booking request to a venue (an internal venue id from searchVenues). It appears in the venue's portal to accept or decline, " +
        "the date is held, and company policy decides whether internal approval is needed first. The user approves before it's sent.",
      inputSchema: z.object({
        venueId: uuid.describe("Internal venue id (tier internal) from searchVenues."),
        eventDate: isoDate,
        partySize: z.number().int().min(1).max(5000),
        budgetPerHeadInr: z.number().positive().max(1_000_000).describe("Per guest, INR before GST."),
        costCenter: z.string().trim().min(1).max(32).describe("The cost centre to charge; ask the user if unknown."),
        departmentId: uuid.nullish(),
        projectCode: z.string().trim().max(32).nullish(),
        alcoholIncluded: z.boolean().nullish(),
        notes: z.string().trim().max(500).nullish().describe("Dietary needs, seating, timings: from the user's preferences and request."),
      }),
      execute: async (input) => {
        const refused = clientOnly();
        if (refused) return refused;
        const result = await placeBookingRequest({
          companyId: companyId!,
          userId: member.userId,
          venueId: input.venueId,
          eventDate: input.eventDate,
          partySize: input.partySize,
          budgetPerHead: input.budgetPerHeadInr,
          notes: input.notes ?? undefined,
          departmentId: input.departmentId ?? null,
          expense: { costCenter: input.costCenter, projectCode: input.projectCode ?? null },
          alcoholIncluded: input.alcoholIncluded ?? false,
        });
        if (result.status === "error") return { ok: false as const, error: result.message, fieldErrors: result.fieldErrors ?? null };
        return {
          ok: true as const,
          bookingId: result.bookingId,
          venue: result.venueName,
          message: result.message,
          awaitingInternalApproval: Boolean(result.approval),
          ...(result.approval && { approval: result.approval }),
          holdHours: result.holdHours ?? null,
          invoiceTotalInr: result.invoice?.invoice_total ?? null,
        };
      },
    }),

    sendSlackApprovalRequest: tool({
      description:
        "Ask the booking's current approver to review it, in the company's Slack approvals channel. Use when a booking is waiting for internal approval " +
        "(a payment or card tool returned needsApproval). The approver decides in LuferAI; this only notifies them.",
      inputSchema: z.object({ bookingId: uuid, note: z.string().trim().max(300).nullish().describe("Optional context from the requester.") }),
      execute: async ({ bookingId, note }) => {
        const refused = clientOnly();
        if (refused) return refused;
        const pending = await pendingApproval(companyId!, bookingId);
        if (!pending) return { ok: false as const, error: "This booking has no pending approval." };
        const channel = env("APPROVALS_SLACK_CHANNEL");
        if (!channel || !env("SLACK_BOT_TOKEN")) return { ok: false as const, error: "Slack approvals aren't configured (APPROVALS_SLACK_CHANNEL, SLACK_BOT_TOKEN).", approver: pending.approver };
        const last = lastPing.get(bookingId);
        if (last && Date.now() - last < REMINDER_WINDOW_MS) return { ok: true as const, sent: false, reason: "A reminder for this booking was sent in the last 15 minutes.", approver: pending.approver };

        const b = pending.booking;
        const text = [
          `*Approval needed* · ${b.venue_name} · ${b.event_date} · ${b.party_size} guests · ${formatINR(Number(b.total_amount_inr))} pre-GST`,
          `Waiting on: ${pending.approver}${pending.remaining > 1 ? ` (then ${pending.remaining - 1} more)` : ""}`,
          pending.reason ? `Why: ${pending.reason}` : null,
          note ? `From the requester: ${note}` : null,
          `Review: ${origin}/client/approvals`,
        ]
          .filter(Boolean)
          .join("\n");
        try {
          await postSlackMessage(channel, text);
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : "Slack send failed", approver: pending.approver };
        }
        lastPing.set(bookingId, Date.now());
        return { ok: true as const, sent: true, approver: pending.approver, reason: pending.reason };
      },
    }),

    issueCorporateVirtualCard: tool({
      description:
        "Issue a single-use corporate virtual card for an approved booking, limited to its approved budget (GST included) or less. " +
        "Its itemised receipt syncs to the company's expense system (Concur / Brex / Ramp) when the venue confirms. The user approves first. " +
        "Cards are currently sandbox-only: say they're test cards that can't be charged.",
      inputSchema: z.object({
        bookingId: uuid,
        amountLimitInr: z.number().positive().max(100_000_000).nullish().describe("Lower limit than the approved budget, if wanted. Omit for the full budget."),
      }),
      execute: async ({ bookingId, amountLimitInr }) => {
        const [booking] = await listBookings({ ids: [bookingId] });
        if (booking?.status === "PENDING_APPROVAL" && (member.role === "ADMIN" || booking.company_id === companyId)) return needsApproval(bookingId);
        try {
          const { card, approvedBudgetInr } = await issueVirtualCard(bookingId, member, { amountLimitInr });
          return { ok: true as const, card, approvedBudgetInr };
        } catch (err) {
          if (err instanceof VirtualCardError) return { ok: false as const, error: err.message };
          throw err;
        }
      },
    }),

    generateBookingContract: tool({
      description:
        "Issue the formal B2B agreement for a booking the venue has accepted: deposit and instalments, GST breakdown, minimum-spend guarantee " +
        "and cancellation terms. Returns the terms and the document hash the client signs. Read the key terms back to the user.",
      inputSchema: z.object({ bookingId: uuid }),
      execute: async ({ bookingId }) => {
        try {
          const contract = await issueContract(bookingId, member);
          return {
            ok: true as const,
            contractId: contract.id,
            status: contract.status,
            documentSha256: contract.document_sha256,
            url: `${origin}/contracts/${contract.id}`,
            terms: contractSummary(contract.terms as unknown as ContractTerms),
          };
        } catch (err) {
          if (err instanceof ContractError) return { ok: false as const, error: err.message };
          throw err;
        }
      },
    }),

    signBookingContract: tool({
      description:
        "Sign a contract as the client, after the user has read it (link from generateBookingContract). The user's approval of this call is their " +
        "electronic signature on exactly that document hash; the venue then countersigns, which executes it and schedules the invoices.",
      inputSchema: z.object({
        contractId: uuid,
        documentSha256: z.string().regex(/^[0-9a-f]{64}$/).describe("The hash from generateBookingContract, so the signature binds to that exact document."),
        signerName: z.string().trim().min(2).max(120).describe("The user's full legal name, as they gave it."),
        signerTitle: z.string().trim().max(120).nullish(),
      }),
      execute: async ({ contractId, documentSha256, signerName, signerTitle }) => {
        try {
          // signContract re-checks the member is the awaited party and that the hash is the current document.
          const status = await signContract(contractId, member, {
            name: signerName,
            title: signerTitle ?? null,
            documentSha256,
            // Consent is the user's approval of this exact call (HMAC-signed by the route).
            consent: true,
            ip: null,
            userAgent: "LuferAI Concierge (signature approved in chat)",
          });
          return { ok: true as const, contractId, status, url: `${origin}/contracts/${contractId}` };
        } catch (err) {
          if (err instanceof ContractError) return { ok: false as const, error: err.message };
          throw err;
        }
      },
    }),
  };
}
