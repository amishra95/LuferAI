import "server-only";

import { agentSnapshot } from "@/lib/agents/store";
import { canAccessWorkspace } from "@/lib/auth/roles";
import type { Member } from "@/lib/auth/session";
import { listAgentRuns } from "@/lib/telemetry/runs";
import { tracer } from "@/lib/tracer";
import { listBookings, listCompanies, listExpenseExports, listRateCards, listVenues } from "@/lib/data";
import { todayInIndia } from "@/lib/gst-engine";
import { isRateCardActive } from "@/lib/rates/apply-rate-card";
import { listDirectory } from "@/lib/venues/directory";
import { describeCancellation, isEnterpriseRate, parseCancellationTerms, parseLayouts, parseSuites } from "@/lib/venues/profile";
import type { EntityKind } from "@/lib/workspace/state";
import type { AgentSummary, InspectedEntity, VenueDetail } from "@/types/workspace";

/** How far back the inspector looks in the run log (it's capped at RUN_LOG_LIMIT). */
const RUN_LOOKBACK = 500;
const RECENT_RUNS = 8;

/**
 * Who may inspect what. Agents, runs and traces are operator data (the /agents
 * workspace and /admin/analytics are admin-only); venues follow /venues and
 * /api/venues, which return the whole directory to anyone allowed there.
 */
export function canInspect(member: Member, kind: EntityKind): boolean {
  if (kind === "venue") return canAccessWorkspace(member.role, member.corporateRole, "/venues");
  return member.role === "ADMIN";
}

/** The entity's details as `member` may see them, or null when it doesn't exist (or has aged out of the logs). */
export async function loadEntity(kind: EntityKind, id: string, member: Member): Promise<InspectedEntity | null> {
  switch (kind) {
    case "agent": {
      const [{ agents }, runs] = await Promise.all([agentSnapshot(), listAgentRuns(RUN_LOOKBACK)]);
      const configured = agents.find((a) => a.agent.id === id);
      const recentRuns = runs.filter((r) => r.agent === id).slice(0, RECENT_RUNS);
      // The /api/ai/* agents have no settings, only runs.
      if (!configured && recentRuns.length === 0) return null;
      return {
        kind,
        id,
        config: configured?.agent ?? null,
        status: configured?.status ?? null,
        runCount: configured?.agent.runCount ?? runs.filter((r) => r.agent === id).length,
        lastRun: configured?.agent.lastRun ?? recentRuns[0] ?? null,
        recentRuns,
      };
    }
    case "run": {
      const run = (await listAgentRuns()).find((r) => r.id === id);
      return run ? { kind, id, run } : null;
    }
    case "trace": {
      const trace = await tracer.getTrace(id);
      return trace ? { kind, id, trace } : null;
    }
    case "venue":
      return loadVenue(id, member);
  }
}

const AUDIT_LIMIT = 12;

/**
 * A venue's corporate profile, the negotiated rates the viewer may see and its
 * booking trail. Clients only ever see their own company's rates and bookings.
 */
async function loadVenue(id: string, member: Member): Promise<VenueDetail | null> {
  const venue = (await listDirectory()).venues.find((v) => v.id === id);
  if (!venue) return null;
  const admin = member.role === "ADMIN";
  const companyId = admin ? undefined : member.companyId ?? "__none__";
  const corporateRole = member.corporateRole;
  const viewer = {
    canBook: member.role === "CLIENT" && venue.tier === "internal" && (corporateRole === "ORGANIZER" || corporateRole === "APPROVER"),
    canSyncExpenses: admin || (member.role === "CLIENT" && corporateRole === "APPROVER"),
  };
  if (venue.tier !== "internal") return { kind: "venue", id, venue, profile: null, rates: [], audit: [], viewer };

  const [row, cards, bookings, companies, exports] = await Promise.all([
    listVenues().then((vs) => vs.find((v) => v.id === id)),
    listRateCards({ venueId: id, ...(companyId && { tenantId: companyId }) }),
    listBookings({ venueId: id, ...(companyId && { companyId }) }),
    listCompanies(),
    listExpenseExports({ ...(companyId && { tenantId: companyId }), limit: 500 }),
  ]);
  const today = todayInIndia();
  const companyName = (cid: string) => companies.find((c) => c.id === cid)?.legal_name.replace(/ Private Limited$/, "") ?? "Unknown company";
  const terms = parseCancellationTerms(row?.cancellation_terms);
  return {
    kind: "venue",
    id,
    venue,
    viewer,
    profile: row
      ? {
          minSpendPerHead: Number(row.min_spend_per_head_inr),
          suites: parseSuites(row.private_suites),
          layouts: parseLayouts(row.seating_layouts),
          cancellation: terms,
          cancellationText: describeCancellation(terms),
          servesAlcohol: row.serves_alcohol,
          entertainment: row.entertainment,
        }
      : null,
    rates: cards.map((c) => ({
      id: c.id,
      company: companyName(c.tenant_id),
      discountPct: Number(c.discount_percentage),
      customPerHead: c.custom_per_head_rate,
      minimumSpendOverride: c.minimum_spend_override,
      effectiveFrom: c.effective_from,
      effectiveTo: c.effective_to,
      active: isRateCardActive(c, today),
      enterpriseBand: isEnterpriseRate(Number(c.discount_percentage)),
    })),
    audit: bookings
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, AUDIT_LIMIT)
      .map((b) => {
        const exp = exports.find((e) => e.booking_id === b.id);
        return {
          bookingId: b.id,
          at: b.updated_at,
          status: b.status,
          eventDate: b.event_date,
          partySize: b.party_size,
          total: Number(b.total_amount_inr),
          company: admin ? companyName(b.company_id) : null,
          alcohol: b.alcohol_included,
          entertainment: b.entertainment,
          expense: exp ? { provider: exp.provider, status: exp.status, attempts: exp.attempts } : null,
          settledAt: b.settled_at,
        };
      }),
  };
}

export async function listAgentSummaries(): Promise<AgentSummary[]> {
  const { agents } = await agentSnapshot();
  return agents.map(({ agent, status }) => ({ id: agent.id, name: agent.name, description: agent.description, status }));
}
