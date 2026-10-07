import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { matchVenues, venueSearchSchema, type VenueSearchFilters } from "@/lib/ai/venue-sourcing";
import { SPEND_GROUPS, SPEND_PERIODS } from "@/lib/analytics/finance";
import { runBudgetForecast, runSpendAnalysis, type AnalyticsScope } from "@/lib/analytics/service";
import { computePlatformMetrics, listBookings } from "@/lib/data";
import { listDirectory } from "@/lib/venues/directory";

const MAX_RESULTS = 6;

/**
 * Searches the two-tier directory: Lufer.ai's own venues (bookable here) and
 * federated partner listings (booked through their supplier). Internal venues
 * rank first; partner results fill the rest. If the partner network is down,
 * internal results still come back with partnerNetwork.status = "unavailable".
 */
export async function searchVenueCatalogue(filters: VenueSearchFilters) {
  const { venues, partners } = await listDirectory();
  const options = matchVenues(venues, filters, null);
  const internal = options.filter((o) => o.venue.tier === "internal");
  const partner = options.filter((o) => o.venue.tier === "partner");
  // Keep at least one partner slot when partners match, so the federated tier stays visible.
  const take = [...internal.slice(0, partner.length ? MAX_RESULTS - 1 : MAX_RESULTS), ...partner].slice(0, MAX_RESULTS);
  return {
    total: options.length,
    internalTotal: internal.length,
    partnerTotal: partner.length,
    partnerNetwork: partners,
    venues: take.map((o) => ({
      name: o.venue.name,
      tier: o.venue.tier,
      supplier: o.venue.supplier,
      bookable: o.venue.bookable,
      neighborhood: o.venue.neighborhood,
      capacity: o.venue.capacity_max,
      minSpendInr: o.venue.min_spend_inr,
      privateDining: o.venue.pdr_available,
      estimatedTotalInr: o.estimatedTotal,
    })),
  };
}

/** The venue search tool, shared by the workspace agent and the channel concierge. */
export const searchVenuesTool = tool({
  description:
    "Search the venue directory in Bengaluru by location, guest count, per-head budget (INR, pre-GST) and features. " +
    "Covers Lufer.ai's own venues (tier internal, bookable here) and partner-network venues (tier partner, booked via their supplier). " +
    "Returns up to 6 matches with estimated cost.",
  inputSchema: venueSearchSchema,
  execute: searchVenueCatalogue,
});

const companyFilter = (scope: AnalyticsScope) =>
  scope.kind === "platform"
    ? z.string().trim().max(120).nullish().describe("Optional: narrow to companies whose name contains this text. Omit for the whole platform.")
    : z.null().optional().describe("Not available: you only see the user's own company.");

/**
 * Tools the workspace agent can call, bound to the caller's analytics scope.
 * The scope comes from the session (client users: their company; admins: the
 * platform), never from the model, so a prompt can't widen what a user sees.
 */
export function createChatTools(scope: AnalyticsScope) {
  const whose = scope.kind === "company" ? `${scope.companyName}'s` : "the platform's (all companies)";
  return {
    searchVenues: searchVenuesTool,

    getPlatformMetrics: tool({
      description: "Get platform-wide booking totals: booking counts, gross booking value, commission and GST collected (INR).",
      inputSchema: z.object({}),
      execute: async () => computePlatformMetrics(await listBookings()),
    }),

    analyzeSpend: tool({
      description:
        `Analyse ${whose} event spend for a period, grouped by month, venue, department, cost centre, company or status. ` +
        "Returns totals (pre-GST spend, GST, invoice total, rate-card savings, average per head) and ranked groups with share of spend. " +
        "Use for questions like 'how much did we spend last quarter', 'top venues this year', 'spend by department'.",
      inputSchema: z.object({
        period: z.enum(SPEND_PERIODS).describe("fytd = Indian financial year (Apr–Mar) to date; last_fy = the previous full FY; next_90_days = already-booked upcoming spend."),
        groupBy: z.enum(SPEND_GROUPS).describe("How to break the spend down."),
        company: companyFilter(scope),
      }),
      execute: ({ period, groupBy, company }) => runSpendAnalysis(scope, { period, groupBy, company }),
    }),

    forecastBudget: tool({
      description:
        `Forecast ${whose} monthly event spend (pre-GST) from the last 12 months' trend plus already-booked events, ` +
        "and compare it to a budget: a department's annual budget, an amount the user gives, or the company's monthly limit × 12. " +
        "Reports projected total, % of budget, the month it runs out and whether it's on track. Use for 'will we stay within budget', 'forecast Q4 spend'.",
      inputSchema: z.object({
        horizonMonths: z.number().int().min(1).max(24).nullish().describe("Months to forecast from this one. Omit for the rest of the financial year."),
        department: z.string().trim().max(80).nullish().describe("Department name (partial match) to forecast and use its annual budget."),
        costCenter: z.string().trim().max(32).nullish().describe("Cost centre code to restrict to."),
        budgetInr: z.number().positive().max(1e12).nullish().describe("A budget in INR to compare against, if the user gives one."),
        company: companyFilter(scope),
      }),
      execute: (input) => runBudgetForecast(scope, input),
    }),
  };
}

export type ChatTools = ReturnType<typeof createChatTools>;
