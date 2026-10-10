import type { TraceRecord } from "@/lib/tracer";
import type { DirectoryVenue } from "@/lib/venues/partner-network";
import type { AgentRecord, AgentRun, AgentStatus } from "@/types/agents";
import type { TaskChannel } from "@/types/channels";

/** One entry of the agent run log, as the inspector shows it. */
export interface RunDetail extends AgentRun {
  id: string;
  agent: string;
  task: string;
  channel: TaskChannel;
  tokens: number;
  steps: number;
}

export interface AgentDetail {
  kind: "agent";
  id: string;
  /** null for run-log-only agents (the /api/ai/* routes have no settings). */
  config: AgentRecord | null;
  status: AgentStatus | null;
  runCount: number;
  lastRun: AgentRun | null;
  /** Newest first, from the most recent part of the run log. */
  recentRuns: RunDetail[];
}

export interface VenueDetail {
  kind: "venue";
  id: string;
  venue: DirectoryVenue;
}

export interface TraceDetail {
  kind: "trace";
  id: string;
  trace: TraceRecord;
}

export interface RunDetailEntity {
  kind: "run";
  id: string;
  run: RunDetail;
}

/** GET /api/workspace/inspect response body. */
export type InspectedEntity = AgentDetail | VenueDetail | TraceDetail | RunDetailEntity;

/** GET /api/workspace/agents: the palette's agent list. */
export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
}
