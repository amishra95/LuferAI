import "server-only";

import { agentSnapshot } from "@/lib/agents/store";
import { canAccessWorkspace } from "@/lib/auth/roles";
import type { Member } from "@/lib/auth/session";
import { listAgentRuns } from "@/lib/telemetry/runs";
import { tracer } from "@/lib/tracer";
import { listDirectory } from "@/lib/venues/directory";
import type { EntityKind } from "@/lib/workspace/state";
import type { AgentSummary, InspectedEntity } from "@/types/workspace";

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

/** The entity's details, or null when it doesn't exist (or has aged out of the logs). */
export async function loadEntity(kind: EntityKind, id: string): Promise<InspectedEntity | null> {
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
    case "venue": {
      const venue = (await listDirectory()).venues.find((v) => v.id === id);
      return venue ? { kind, id, venue } : null;
    }
  }
}

export async function listAgentSummaries(): Promise<AgentSummary[]> {
  const { agents } = await agentSnapshot();
  return agents.map(({ agent, status }) => ({ id: agent.id, name: agent.name, description: agent.description, status }));
}
