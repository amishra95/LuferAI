/**
 * Which tools a chat turn may use, and when a tool call is mandatory. Pure
 * (tested in tests/chat-policy.test.mjs); applied in app/api/chat/route.ts.
 *
 * Finance questions must be answered from analyzeSpend / forecastBudget output,
 * never from the model's own arithmetic or memory, so for those the first step
 * offers only the finance tools and requires a call.
 */
import type { PortalRole } from "@/lib/supabase/database.types";

export const FINANCE_TOOLS = ["analyzeSpend", "forecastBudget"] as const;

/** Tools that read platform-wide figures (every company's bookings): admins only. */
export const ADMIN_ONLY_TOOLS: readonly string[] = ["getPlatformMetrics"];

/** Unambiguous spend / forecasting vocabulary. */
const FINANCE_TERMS =
  /\b(spend|spent|spending|expenses?|expenditure|forecast\w*|projections?|projected|savings|saved|gst|itc|input tax credit|run[- ]?rate|burn|cost cent(re|er)s?|year[- ]to[- ]date|ytd|fytd)\b/i;
/** "Budget" is ambiguous: a per-head budget is a venue-search filter, a department budget is finance. */
const BUDGET = /\bbudgets?\b/i;
const BUDGET_FINANCE_CONTEXT =
  /\b(remaining|left|on track|within|over|exceed\w*|utili[sz]\w*|department|team|quarter|q[1-4]|year|annual|fy\d*|month(ly)?|run out|burn)\b/i;
const VENUE_SEARCH = /\b(find|search|suggest|recommend|shortlist|book|venues? for|place for|per[- ]head|guests|people|pax|capacity)\b/i;

/** Does this message ask about spend, budgets or forecasts (rather than finding a venue)? */
export function isFinanceQuery(text: string): boolean {
  if (FINANCE_TERMS.test(text)) return true;
  return BUDGET.test(text) && BUDGET_FINANCE_CONTEXT.test(text) && !VENUE_SEARCH.test(text);
}

/** The agent's configured tools minus those the caller's role may not use. */
export function allowedTools<T extends string>(role: PortalRole, agentTools: readonly T[]): T[] {
  return role === "ADMIN" ? [...agentTools] : agentTools.filter((t) => !ADMIN_ONLY_TOOLS.includes(t));
}

/**
 * First-step override for a finance question: only the finance tools the
 * caller may use, and a call is required. Null when the turn isn't finance or
 * no finance tool is enabled (the model then answers normally and the system
 * prompt tells it not to guess figures).
 */
export function financeFirstStep<T extends string>(allowed: readonly T[], lastUserText: string): { activeTools: T[]; toolChoice: "required" } | null {
  if (!isFinanceQuery(lastUserText)) return null;
  const finance = allowed.filter((t) => (FINANCE_TOOLS as readonly string[]).includes(t));
  return finance.length ? { activeTools: finance, toolChoice: "required" } : null;
}
