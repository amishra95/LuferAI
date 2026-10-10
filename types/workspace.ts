import type { TraceRecord } from "@/lib/tracer";
import type { DirectoryVenue } from "@/lib/venues/partner-network";
import type { AgentRecord, AgentRun, AgentStatus } from "@/types/agents";
import type { TaskChannel } from "@/types/channels";
import type { LifecycleStatus } from "@/lib/bookings/lifecycle";
import type { CancellationTier, LayoutCapacity, PrivateSuite } from "@/lib/venues/profile";

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

/** The corporate profile of a Lufer.ai venue (partner listings don't carry one). */
export interface VenueProfileInfo {
  minSpendPerHead: number;
  suites: PrivateSuite[];
  layouts: LayoutCapacity[];
  cancellation: CancellationTier[];
  cancellationText: string;
  servesAlcohol: boolean;
  entertainment: string[];
}

/** A negotiated corporate rate at this venue (only the viewer's company's, unless they're an admin). */
export interface VenueRateInfo {
  id: string;
  company: string;
  discountPct: number;
  customPerHead: number | null;
  minimumSpendOverride: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  /** Within the 10–15% enterprise band. */
  enterpriseBand: boolean;
}

/** One booking at this venue, newest activity first: the venue's audit trail. */
export interface VenueAuditEntry {
  bookingId: string;
  at: string;
  status: LifecycleStatus;
  eventDate: string;
  partySize: number;
  total: number;
  /** Admins see whose booking it is. */
  company: string | null;
  alcohol: boolean;
  entertainment: string[];
  expense: { provider: string; status: string; attempts: number } | null;
  settledAt: string | null;
}

export interface VenueDetail {
  kind: "venue";
  id: string;
  venue: DirectoryVenue;
  profile: VenueProfileInfo | null;
  rates: VenueRateInfo[];
  audit: VenueAuditEntry[];
  /** What the viewer may do here. */
  viewer: { canBook: boolean; canSyncExpenses: boolean };
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
