import "server-only";

import type { Member } from "@/lib/auth/session";
import { notifyEscalation } from "@/lib/escalations/notify";
import { parseDecision, priceFor, statusFor } from "@/lib/escalations/rules";
import { claimDecision, EscalationError, getEscalation, recordEvent, reopenEscalation, type Escalation } from "@/lib/escalations/store";
import { GuardrailError, respondToRfp } from "@/lib/rfp/service";
import { tracer } from "@/lib/tracer";

/**
 * A reviewer's decision on an escalation: approve the held-back counter,
 * send it at another price, or reject it (the instant quote stands).
 *
 * The escalation is claimed first (one conditional update), so two reviewers
 * can't both act. A counter then goes through respondToRfp, the same path as
 * the RFP inbox, so the venue's guardrails and the platform's ceilings still
 * apply; if they refuse the price, the claim is undone and the reason is
 * recorded. Venue hosts decide their own venue's escalations; admins any.
 */
export async function decideEscalation(id: string, input: { action: unknown; perHead?: unknown; note?: unknown }, member: Member): Promise<Escalation> {
  if (member.role !== "ADMIN" && !(member.role === "PROPERTY" && member.venueId)) throw new EscalationError("Only the venue's host or an admin can decide escalations.");
  const parsed = parseDecision(input);
  if (!parsed.ok) throw new EscalationError(parsed.error);
  const decision = parsed.value;
  const scope = member.role === "ADMIN" ? {} : { venueId: member.venueId! };
  const actor = { id: member.userId, role: member.role };

  const current = await getEscalation(id);
  if (!current || (scope.venueId && current.venueId !== scope.venueId)) throw new EscalationError("That escalation doesn't exist.");
  if (current.status !== "open") throw new EscalationError(`This escalation was already ${current.status}.`);
  if (current.rfp.status !== "open") throw new EscalationError("The RFP has closed, so there's nothing to counter any more.");

  const price = priceFor(decision, current.proposedPerHead);
  const status = statusFor(decision);
  return tracer.trace(
    "escalation.decide",
    async (span) => {
      const claimed = await claimDecision(id, scope, { status, perHead: price, note: decision.note }, actor);
      if (!claimed) throw new EscalationError("Someone else decided this escalation a moment ago. Refresh to see what they chose.");
      if (price !== null) {
        try {
          await respondToRfp({
            responseId: claimed.responseId,
            venueId: claimed.venueId,
            decline: false,
            perHeadInr: price,
            // Keep the package the instant quote offered, so the discount is measured from it.
            menuPackageId: claimed.response.menuPackageId,
            notes: decision.note,
            actor,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : "The counter couldn't be sent.";
          await reopenEscalation(id, actor, reason);
          span.setAttribute("refused", true);
          if (err instanceof GuardrailError) throw new EscalationError(`Not sent: ${reason}`);
          throw err;
        }
      }
      await recordEvent(id, status, actor, { perHead: price, proposedPerHead: claimed.proposedPerHead, note: decision.note });
      notifyEscalation(id, "decided", member.email ?? (member.role === "ADMIN" ? "an admin" : "the venue host"));
      return claimed;
    },
    { attributes: { escalation: id.slice(0, 8), venueId: current.venueId, venue: current.venueName, decision: status, perHeadInr: price, proposedPerHead: current.proposedPerHead, by: member.role } }
  );
}
