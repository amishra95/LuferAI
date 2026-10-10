/**
 * Live telemetry events: what /api/telemetry/stream sends to the browser.
 *
 *   span           a traced operation finished (trace still running, or just ended)
 *   trace          a whole trace was stored and can be opened by id
 *   run            an agent run was logged (lib/telemetry/runs.ts)
 *   venue-sync     the venue directory was re-pulled
 *   agent-config   an agent was enabled/disabled or reconfigured
 *   venue-updated  a directory listing was edited, (un)published or removed
 *   booking        a booking moved along its lifecycle (agent, approval, settlement)
 *   approval       a spend approval was decided
 *   expense        a booking was exported to the company's expense system
 *   po             a blanket purchase order was raised, closed, reopened or drawn on
 *   order          a catalogue order moved along its lifecycle (buyer, supplier, approval, agent)
 *
 * Every event has a `seq` from the event log (lib/telemetry/event-log.ts),
 * increasing across server instances, which doubles as the SSE event id so a
 * reconnecting EventSource resumes where it left off.
 *
 * Pure and dependency-free: the server encodes with it, the client parses with
 * it (hand-rolled checks rather than zod keep it out of the shell's bundle),
 * and tests import it directly (tests/telemetry-events.test.mjs).
 */

export type LiveSpanStatus = "ok" | "error";

export interface LiveSpan {
  spanId: string;
  parentId: string | null;
  name: string;
  /** Epoch ms. */
  start: number;
  durationMs: number;
  status: LiveSpanStatus;
  error?: { name: string; message: string };
}

export interface LiveRun {
  id: string;
  agent: string;
  at: string;
  ok: boolean;
  task: string;
  durationMs: number;
  source: string;
  channel: string;
  tokens: number;
  steps: number;
  error?: string;
}

export type PartnerSyncStatus = { network: string; status: "ok"; count: number } | { network: string; status: "unavailable"; error: string };

export const AGENT_CONFIG_FIELDS = ["enabled", "tools", "temperature", "maxSteps", "instructions"] as const;
export type AgentConfigField = (typeof AGENT_CONFIG_FIELDS)[number];

export const VENUE_CHANGES = ["saved", "published", "unpublished", "deleted"] as const;
export type VenueChange = (typeof VENUE_CHANGES)[number];

export const BOOKING_EVENT_STATUSES = ["PENDING_APPROVAL", "PENDING", "CONFIRMED", "COMPLETED", "SETTLED", "CANCELLED"] as const;
export type BookingEventStatus = (typeof BOOKING_EVENT_STATUSES)[number];

export const ORDER_EVENT_STATUSES = ["PENDING_APPROVAL", "PLACED", "CONFIRMED", "SHIPPED", "DELIVERED", "SETTLED", "CANCELLED"] as const;
export type OrderEventStatus = (typeof ORDER_EVENT_STATUSES)[number];
export const ORDER_EVENT_ACTORS = ["buyer", "supplier", "approval", "agent", "expense"] as const;
export type OrderEventActor = (typeof ORDER_EVENT_ACTORS)[number];

export const PO_CHANGES = ["created", "closed", "reopened", "reallocated"] as const;
export type PoChange = (typeof PO_CHANGES)[number];

export type TelemetryEventBody =
  | { type: "span"; traceId: string; root: boolean; span: LiveSpan }
  | { type: "trace"; traceId: string; name: string; status: LiveSpanStatus; durationMs: number; spans: number }
  | { type: "run"; run: LiveRun }
  | { type: "venue-sync"; total: number; partners: PartnerSyncStatus }
  | { type: "agent-config"; agentId: string; enabled: boolean; changed: AgentConfigField[] }
  | { type: "venue-updated"; venueId: string; change: VenueChange }
  | { type: "booking"; bookingId: string; venueId: string; status: BookingEventStatus; by: "agent" | "approval" | "expense" }
  | { type: "approval"; approvalId: string; bookingId: string; decision: "APPROVED" | "REJECTED" }
  | { type: "expense"; bookingId: string; provider: string; status: "delivered" | "mocked" | "failed" | "skipped" }
  | { type: "po"; poId: string; change: PoChange }
  | { type: "order"; orderId: string; partnerId: string; status: OrderEventStatus; by: OrderEventActor };

/** An event as published, before the log numbers it. */
export type NewTelemetryEvent = TelemetryEventBody & { at: number };

export type TelemetryEvent = NewTelemetryEvent & { seq: number };

export type TelemetryEventType = TelemetryEvent["type"];

/** The SSE `event:` name for telemetry messages (the client listens for it). */
export const SSE_EVENT = "telemetry";

/** What a viewer may receive: operator data (spans, traces, runs) vs the venue directory. */
export interface TelemetryAudience {
  ops: boolean;
  venues: boolean;
}

export function visibleTo(event: Pick<TelemetryEvent, "type">, audience: TelemetryAudience): boolean {
  return event.type === "venue-sync" || event.type === "venue-updated" ? audience.venues : audience.ops;
}

// ----------------------------------------------------------------------------
// SSE encoding
// ----------------------------------------------------------------------------

/** One SSE message: `id:` is the seq, `data:` the JSON (JSON never contains a raw newline). */
export function encodeSseEvent(event: TelemetryEvent): string {
  return `id: ${event.seq}\nevent: ${SSE_EVENT}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** A comment line: keeps proxies from timing out an idle stream. */
export const SSE_HEARTBEAT = ": keep-alive\n\n";

export const sseRetry = (ms: number) => `retry: ${Math.max(0, Math.round(ms))}\n\n`;

/** A Last-Event-ID / ?since cursor, or null when absent or malformed. */
export function parseCursor(raw: string | null | undefined): number | null {
  if (raw == null || !/^\d{1,15}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

// ----------------------------------------------------------------------------
// Parsing (client side, and the Redis log on read)
// ----------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500): v is string => typeof v === "string" && v.length <= max;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const status = (v: unknown): v is LiveSpanStatus => v === "ok" || v === "error";

function errorInfo(v: unknown): { name: string; message: string } | undefined | false {
  if (v === undefined) return undefined;
  return isObj(v) && str(v.name) && str(v.message, 2000) ? { name: v.name, message: v.message } : false;
}

function span(v: unknown): LiveSpan | null {
  if (!isObj(v) || !str(v.spanId, 64) || !(v.parentId === null || str(v.parentId, 64)) || !str(v.name, 200)) return null;
  if (!num(v.start) || !num(v.durationMs) || !status(v.status)) return null;
  const error = errorInfo(v.error);
  if (error === false) return null;
  return { spanId: v.spanId, parentId: v.parentId as string | null, name: v.name, start: v.start, durationMs: v.durationMs, status: v.status, ...(error && { error }) };
}

function run(v: unknown): LiveRun | null {
  if (!isObj(v) || !str(v.id, 64) || !str(v.agent, 64) || !str(v.at, 40) || typeof v.ok !== "boolean" || !str(v.task, 500)) return null;
  if (!num(v.durationMs) || !str(v.source, 32) || !str(v.channel, 32) || !num(v.tokens) || !num(v.steps)) return null;
  if (v.error !== undefined && !str(v.error, 2000)) return null;
  return {
    id: v.id,
    agent: v.agent,
    at: v.at,
    ok: v.ok,
    task: v.task,
    durationMs: v.durationMs,
    source: v.source,
    channel: v.channel,
    tokens: v.tokens,
    steps: v.steps,
    ...(typeof v.error === "string" && { error: v.error }),
  };
}

function partners(v: unknown): PartnerSyncStatus | null {
  if (!isObj(v) || !str(v.network, 200)) return null;
  if (v.status === "ok" && num(v.count)) return { network: v.network, status: "ok", count: v.count };
  if (v.status === "unavailable" && str(v.error, 2000)) return { network: v.network, status: "unavailable", error: v.error };
  return null;
}

/** Validates one decoded event; anything malformed or of an unknown type is null. */
export function toTelemetryEvent(v: unknown): TelemetryEvent | null {
  if (!isObj(v) || !num(v.seq) || v.seq < 1 || !Number.isInteger(v.seq) || !num(v.at)) return null;
  const base = { seq: v.seq, at: v.at };
  switch (v.type) {
    case "span": {
      const s = span(v.span);
      return s && str(v.traceId, 64) && typeof v.root === "boolean" ? { ...base, type: "span", traceId: v.traceId, root: v.root, span: s } : null;
    }
    case "trace":
      return str(v.traceId, 64) && str(v.name, 200) && status(v.status) && num(v.durationMs) && num(v.spans)
        ? { ...base, type: "trace", traceId: v.traceId, name: v.name, status: v.status, durationMs: v.durationMs, spans: v.spans }
        : null;
    case "run": {
      const r = run(v.run);
      return r ? { ...base, type: "run", run: r } : null;
    }
    case "venue-sync": {
      const p = partners(v.partners);
      return p && num(v.total) ? { ...base, type: "venue-sync", total: v.total, partners: p } : null;
    }
    case "agent-config": {
      const changed = Array.isArray(v.changed) && v.changed.every((f) => (AGENT_CONFIG_FIELDS as readonly unknown[]).includes(f)) ? (v.changed as AgentConfigField[]) : null;
      return str(v.agentId, 64) && typeof v.enabled === "boolean" && changed
        ? { ...base, type: "agent-config", agentId: v.agentId, enabled: v.enabled, changed: [...changed] }
        : null;
    }
    case "venue-updated":
      return str(v.venueId, 128) && (VENUE_CHANGES as readonly unknown[]).includes(v.change)
        ? { ...base, type: "venue-updated", venueId: v.venueId, change: v.change as VenueChange }
        : null;
    case "booking":
      return str(v.bookingId, 64) && str(v.venueId, 128) && (BOOKING_EVENT_STATUSES as readonly unknown[]).includes(v.status) && (v.by === "agent" || v.by === "approval" || v.by === "expense")
        ? { ...base, type: "booking", bookingId: v.bookingId, venueId: v.venueId, status: v.status as BookingEventStatus, by: v.by }
        : null;
    case "approval":
      return str(v.approvalId, 64) && str(v.bookingId, 64) && (v.decision === "APPROVED" || v.decision === "REJECTED")
        ? { ...base, type: "approval", approvalId: v.approvalId, bookingId: v.bookingId, decision: v.decision }
        : null;
    case "expense":
      return str(v.bookingId, 64) && str(v.provider, 32) && (v.status === "delivered" || v.status === "mocked" || v.status === "failed" || v.status === "skipped")
        ? { ...base, type: "expense", bookingId: v.bookingId, provider: v.provider, status: v.status }
        : null;
    case "order":
      return str(v.orderId, 64) && str(v.partnerId, 64) && (ORDER_EVENT_STATUSES as readonly unknown[]).includes(v.status) && (ORDER_EVENT_ACTORS as readonly unknown[]).includes(v.by)
        ? { ...base, type: "order", orderId: v.orderId, partnerId: v.partnerId, status: v.status as OrderEventStatus, by: v.by as OrderEventActor }
        : null;
    case "po":
      return str(v.poId, 64) && (PO_CHANGES as readonly unknown[]).includes(v.change) ? { ...base, type: "po", poId: v.poId, change: v.change as PoChange } : null;
    default:
      return null;
  }
}

/** An SSE `data:` payload → event, or null if it isn't valid JSON or a valid event. */
export function parseTelemetryEvent(data: string): TelemetryEvent | null {
  try {
    return toTelemetryEvent(JSON.parse(data));
  } catch {
    return null;
  }
}
