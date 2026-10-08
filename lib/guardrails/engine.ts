/**
 * Deterministic guardrails for the AI tools that change data.
 *
 *   const check = await checkToolCall("setMinimumSpend", args, async (a) =>
 *     minimumSpendRules(a, { current: await currentMinSpend() }), { venueId });
 *   if (!check.ok) return refusal(check);   // nothing was written
 *   … perform the mutation with check.args …
 *
 * checkToolCall re-validates the arguments against the tool's schema (the model's
 * output is never trusted, even after the AI SDK parsed it), runs the tool's rules
 * against the current state, and records every decision as a `guardrail.<tool>`
 * span via lib/tracer.ts: allowed calls with their key facts, refusals as failed
 * spans (GuardrailDenied: <code>) so they show up under failed traces on
 * /admin/analytics.
 *
 * These checks sit in front of, not instead of, the existing ones:
 * placeBookingRequest (role, capacity, minimum spend, policy, date holds), RLS on
 * the signed-in user's client, and signed human approval for pricing changes.
 *
 * The rules are pure, so tests/guardrails.test.mjs covers them without a database.
 */
import { tracer } from "../tracer.ts";
import { GUARDRAIL_LIMITS, MUTATING_TOOLS, type CreateBookingInput, type MutatingTool, type SetMinimumSpendInput, type UpsertMenuPackageInput } from "./schemas.ts";

export type GuardrailCode =
  | "invalid_input"
  | "not_linked"
  | "rate_limited"
  | "duplicate_request"
  | "date_out_of_range"
  | "change_too_large"
  | "price_out_of_range"
  | "last_active_package"
  | "unknown_package";

export type GuardrailDecision = { allowed: true; facts?: Record<string, unknown> } | { allowed: false; code: GuardrailCode; message: string; facts?: Record<string, unknown> };

export type GuardrailResult<A> = { ok: true; args: A } | { ok: false; code: GuardrailCode; message: string };

const allow = (facts?: Record<string, unknown>): GuardrailDecision => ({ allowed: true, facts });
const deny = (code: GuardrailCode, message: string, facts?: Record<string, unknown>): GuardrailDecision => ({ allowed: false, code, message, facts });

/** Thrown into the audit span (never to the caller) so refusals count as failures in traces. */
export class GuardrailDenied extends Error {
  constructor(code: GuardrailCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "GuardrailDenied";
  }
}

const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// ----------------------------------------------------------------------------
// Rules (pure)
// ----------------------------------------------------------------------------

export interface BookingContext {
  /** YYYY-MM-DD */
  today: string;
  /** The sender is linked to a portal user (otherwise they may only search). */
  linked: boolean;
  /** Bookings this sender filed in the last hour. */
  bookingsLastHour: number;
  /** This sender already requested this venue and date within the duplicate window. */
  duplicate: boolean;
}

export function bookingRules(args: CreateBookingInput, ctx: BookingContext, limits = GUARDRAIL_LIMITS.booking): GuardrailDecision {
  const facts = { eventDate: args.eventDate, partySize: args.partySize, bookingsLastHour: ctx.bookingsLastHour };
  if (!ctx.linked) {
    return deny("not_linked", "This sender isn't linked to a Lufer.ai account, so I can only search. Ask your admin to link you in Settings → Channels.", facts);
  }
  const latest = addDays(ctx.today, limits.maxDaysAhead);
  if (args.eventDate > latest) {
    return deny("date_out_of_range", `Bookings can be made up to ${limits.maxDaysAhead} days ahead (until ${latest}). For later events, use the client portal.`, facts);
  }
  if (ctx.duplicate) {
    return deny("duplicate_request", `You've already requested this venue for ${args.eventDate}. Check the client portal for its status instead of filing it again.`, facts);
  }
  if (ctx.bookingsLastHour >= limits.perSenderPerHour) {
    return deny("rate_limited", `That's ${ctx.bookingsLastHour} booking requests in the last hour, the most I can file from chat. Try again later or use the client portal.`, facts);
  }
  return allow(facts);
}

export function minimumSpendRules(args: SetMinimumSpendInput, ctx: { current: number }, limits = GUARDRAIL_LIMITS.minimumSpend): GuardrailDecision {
  const facts = { current: ctx.current, proposed: args.min_spend_inr };
  // From zero there's no baseline to compare with; the schema's absolute cap still applies.
  if (ctx.current > 0) {
    const change = Math.abs(args.min_spend_inr - ctx.current) / ctx.current;
    if (change > limits.maxChangeFraction) {
      const lo = Math.ceil(ctx.current * (1 - limits.maxChangeFraction));
      const hi = Math.floor(ctx.current * (1 + limits.maxChangeFraction));
      return deny(
        "change_too_large",
        `A ${Math.round(change * 100)}% change is more than the ${Math.round(limits.maxChangeFraction * 100)}% one change may make. Propose a value between ₹${lo.toLocaleString("en-IN")} and ₹${hi.toLocaleString("en-IN")}, or change it in steps.`,
        { ...facts, changePct: Math.round(change * 100) }
      );
    }
  }
  return allow(facts);
}

export interface MenuPackageContext {
  /** Ids of the venue's currently active packages. */
  activePackageIds: string[];
  /** For updates: whether package_id belongs to this venue. */
  packageExists: boolean;
}

export function menuPackageRules(args: UpsertMenuPackageInput, ctx: MenuPackageContext, limits = GUARDRAIL_LIMITS.menuPackage): GuardrailDecision {
  const facts = { packageId: args.package_id, perHeadInr: args.per_head_inr, isActive: args.is_active, activePackages: ctx.activePackageIds.length };
  if (args.package_id && !ctx.packageExists) return deny("unknown_package", "That package doesn't exist at this venue. Call getVenueTerms for current package ids.", facts);
  if (args.per_head_inr < limits.minPerHeadInr || args.per_head_inr > limits.maxPerHeadInr) {
    return deny(
      "price_out_of_range",
      `Per-head prices must be between ₹${limits.minPerHeadInr.toLocaleString("en-IN")} and ₹${limits.maxPerHeadInr.toLocaleString("en-IN")}.`,
      facts
    );
  }
  const deactivatesLast = !args.is_active && args.package_id !== null && ctx.activePackageIds.length === 1 && ctx.activePackageIds[0] === args.package_id;
  if (deactivatesLast) return deny("last_active_package", "This is the venue's only active package; deactivating it would leave nothing to quote. Add or activate another first.", facts);
  return allow(facts);
}

// ----------------------------------------------------------------------------
// Enforcement + audit
// ----------------------------------------------------------------------------

/**
 * Validates `rawArgs` for `tool`, evaluates `rules` and records the decision as a
 * `guardrail.<tool>` span with `audit` (who/where, never secrets: the tracer
 * redacts sensitive keys anyway). Returns the parsed arguments to act on, or a
 * refusal to hand back to the model. Never throws for a refusal.
 */
export async function checkToolCall<T extends MutatingTool>(
  tool: T,
  rawArgs: unknown,
  rules: (args: ReturnType<(typeof MUTATING_TOOLS)[T]["parse"]>) => GuardrailDecision | Promise<GuardrailDecision>,
  audit: Record<string, unknown> = {}
): Promise<GuardrailResult<ReturnType<(typeof MUTATING_TOOLS)[T]["parse"]>>> {
  return tracer.trace(`guardrail.${tool}`, async (span) => {
    span.setAttributes({ tool, ...audit });
    const parsed = MUTATING_TOOLS[tool].safeParse(rawArgs);
    let decision: GuardrailDecision;
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      decision = deny("invalid_input", `Invalid ${issue?.path.join(".") || "arguments"}: ${issue?.message ?? "rejected"}`);
    } else {
      decision = await rules(parsed.data as ReturnType<(typeof MUTATING_TOOLS)[T]["parse"]>);
    }
    span.setAttributes({ decision: decision.allowed ? "allow" : "deny", ...(decision.facts ?? {}) });
    if (!decision.allowed) {
      span.setAttribute("code", decision.code);
      span.recordError(new GuardrailDenied(decision.code, decision.message));
      return { ok: false, code: decision.code, message: decision.message };
    }
    return { ok: true, args: parsed.data as ReturnType<(typeof MUTATING_TOOLS)[T]["parse"]> };
  });
}
