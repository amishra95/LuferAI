import "server-only";

import { DEFAULT_BACKEND, MODEL_BACKEND_LABEL, MODEL_BACKENDS } from "@/lib/agents/config";
import { isBackendConfigured } from "@/lib/ai/model";
import { llmCircuitBreaker } from "@/lib/circuit-breaker";
import { GUARDRAIL_LIMITS } from "@/lib/guardrails/schemas";
import { MAX_DISCOUNT_CAP } from "@/lib/rfp/guardrails";
import { appProviderHealthStore, combinedCircuit, instanceId, type SharedProviderHealth } from "@/lib/telemetry/provider-health";
import { listAgentRuns, type LoggedRun } from "@/lib/telemetry/runs";
import { TRACE_LIST_LIMIT, tracer, type Attributes, type SpanRecord, type TraceRecord } from "@/lib/tracer";
import { formatINR } from "@/lib/utils";
import type { ObservabilityEvent, ProviderHealth, TraceOutcome } from "@/types/agents";

/**
 * The /agents dashboard's read API. Everything it shows is persisted, in
 * Upstash Redis when configured (else process memory):
 *
 * - the activity feed: prompt calls from the run log (lib/telemetry/runs), plus
 *   guardrail decisions and negotiation steps read off recorded traces (lib/tracer);
 * - provider health: circuit breaker counters and states from every instance
 *   (lib/telemetry/provider-health);
 * - the raw logs behind them, re-exported below.
 *
 * Nothing here is sampled or invented; an empty feed means nothing has run
 * since the logs were last trimmed.
 */

export { agentRunStats, listAgentRuns, type LoggedRun } from "@/lib/telemetry/runs";
export { bookingActivity } from "@/lib/guardrails/state";
export { TRACE_LIST_LIMIT, type SpanRecord, type TraceRecord } from "@/lib/tracer";

/** Recorded traces, newest first (the same store /admin/analytics reads). */
export const listTraces = (options: Parameters<typeof tracer.listTraces>[0] = { limit: TRACE_LIST_LIMIT }) => tracer.listTraces(options);
/** One recorded trace by id, or null once it has been trimmed. */
export const getTrace = (traceId: string) => tracer.getTrace(traceId);

/** What people do instead when an agent's model call fails. Keep in step with the pages it names. */
export const FALLBACK_PATH: Record<string, string> = {
  "property-negotiator":
    "Hosts counter or decline RFPs by hand in the RFP inbox on /property. Minimum-spend and menu-package changes wait until the negotiator is back.",
  "rfp-broadcaster": "Clients pick a venue and file an event request from the venue explorer on /client.",
  "venue-sourcer": "Clients filter the venue catalogue by hand in the venue explorer on /client.",
  "brief-writer": "Hosts work from the booking details and client notes on /property.",
  "channel-concierge": "The sender gets a “try again in a few minutes” reply and can book on the client portal.",
  "workspace-agent": "Admins read the same figures on /admin/analytics.",
  "metrics-reporter": "Admins read the same figures on /admin/analytics.",
};

/** Root spans of the AI routes, by the agent they run. */
const ROUTE_AGENT: Record<string, string> = {
  "api.chat": "workspace-agent",
  "api.ai.generate-brief": "brief-writer",
  "api.ai.rfp-broadcast": "rfp-broadcaster",
  "api.ai.property-negotiator": "property-negotiator",
  "api.ai.source-venues": "venue-sourcer",
};

/** Guardrailed tools, by the agent that calls them. */
const TOOL_AGENT: Record<string, string> = {
  setMinimumSpend: "property-negotiator",
  upsertMenuPackage: "property-negotiator",
  createBooking: "channel-concierge",
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const inr = (v: unknown) => (num(v) === null ? "—" : formatINR(num(v)!));

function fromRun(r: LoggedRun): ObservabilityEvent {
  return {
    id: `run:${r.id}`,
    // Logged when they finish; the feed is ordered by start.
    at: new Date(new Date(r.at).getTime() - r.durationMs).toISOString(),
    kind: "prompt",
    outcome: r.ok ? "success" : "fallback",
    agent: r.agent,
    title: r.task,
    detail: r.ok ? (r.source === "test" ? "Each assigned tool ran once with a sample input; no model call." : `Completed in ${(r.durationMs / 1000).toFixed(2)} s`) : (r.error ?? "Run failed"),
    durationMs: r.durationMs,
    tokens: r.tokens || null,
    traceId: null,
    facts: [
      ["source", r.source],
      ...(r.steps ? [["steps", String(r.steps)] as [string, string]] : []),
    ],
    fallback: r.ok ? undefined : FALLBACK_PATH[r.agent],
  };
}

const GUARDRAIL_FACTS: [key: string, label: string, format?: (v: unknown) => string][] = [
  ["current", "current", inr],
  ["proposed", "proposed", inr],
  ["changePct", "change", (v) => `${v}%`],
  ["perHeadInr", "per head", inr],
  ["activePackages", "active packages"],
  ["eventDate", "event date"],
  ["partySize", "party"],
  ["bookingsLastHour", "filed last hour"],
];

function factsOf(attrs: Attributes, spec: typeof GUARDRAIL_FACTS): [string, string][] {
  return spec.flatMap(([key, label, format]) => {
    const v = attrs[key];
    if (v === undefined || v === null) return [];
    return [[label, format ? format(v) : String(v)] as [string, string]];
  });
}

function fromGuardrail(t: TraceRecord, s: SpanRecord): ObservabilityEvent {
  const tool = str(s.attributes.tool) ?? s.name.replace(/^guardrail\./, "");
  const denied = s.attributes.decision === "deny";
  // GuardrailDenied messages read "<code>: <message>".
  const message = s.error?.message.replace(/^[a-z_]+: /, "");
  return {
    id: `${t.traceId}:${s.spanId}`,
    at: new Date(s.start).toISOString(),
    kind: "guardrail",
    outcome: denied ? "auto-decline" : s.status === "error" ? "fallback" : "success",
    agent: TOOL_AGENT[tool] ?? "unknown",
    title: `${tool} ${denied ? "refused" : s.status === "error" ? "failed" : "allowed"}`,
    detail: denied ? (message ?? "Refused by guardrail") : s.status === "error" ? (s.error?.message ?? "Guardrail check failed") : "Arguments valid and within limits; the write went ahead.",
    durationMs: s.durationMs,
    tokens: null,
    traceId: t.traceId,
    facts: [...(denied && str(s.attributes.code) ? [["rule", str(s.attributes.code)!] as [string, string]] : []), ...factsOf(s.attributes, GUARDRAIL_FACTS)],
  };
}

type QuoteOutcome = { venue?: unknown; status?: unknown; perHeadInr?: unknown; standardPerHead?: unknown; floored?: unknown; overBudget?: unknown; reason?: unknown };

function fromBroadcast(t: TraceRecord, s: SpanRecord): ObservabilityEvent[] {
  const at = new Date(s.start).toISOString();
  const rfp = str(s.attributes.rfp);
  if (s.status === "error") {
    return [
      {
        id: `${t.traceId}:${s.spanId}`,
        at,
        kind: "negotiation",
        outcome: "fallback",
        agent: "rfp-broadcaster",
        title: "RFP broadcast failed",
        detail: s.error?.message ?? "Quoting failed after the brief was read",
        durationMs: s.durationMs,
        tokens: null,
        traceId: t.traceId,
        facts: [],
        fallback: FALLBACK_PATH["rfp-broadcaster"],
      },
    ];
  }
  const outcomes = Array.isArray(s.attributes.outcomes) ? (s.attributes.outcomes as QuoteOutcome[]) : [];
  const budget = num(s.attributes.budgetPerHead);
  const shared: [string, string][] = [
    ...(rfp ? [["rfp", rfp] as [string, string]] : []),
    ...(num(s.attributes.partySize) ? [["party", String(s.attributes.partySize)] as [string, string]] : []),
    ...(budget ? [["ask", `${formatINR(budget)}/head`] as [string, string]] : []),
  ];
  return outcomes.map((o, i) => {
    const venue = str(o.venue) ?? "Venue";
    let outcome: TraceOutcome = "success";
    let title = `${venue} · instant quote`;
    let detail = [
      `Quoted ${inr(o.perHeadInr)}/head`,
      o.overBudget ? "above the per-head ask (no package fits the budget)" : "within the ask",
      o.floored ? "lifted to the minimum spend" : null,
    ]
      .filter(Boolean)
      .join(", ")
      .concat(".");
    if (o.status === "auto_counter") {
      outcome = "auto-counter";
      title = `${venue} · auto-counter`;
      detail = `${str(o.reason) ?? `Countered at ${inr(o.perHeadInr)}/head.`} Standard price ${inr(o.standardPerHead)}/head; within the venue's floor and discount ceiling.`;
    } else if (o.status === "auto_decline") {
      outcome = "auto-decline";
      title = `${venue} · auto-decline`;
      detail = str(o.reason) ?? "Declined automatically: the budget can't reach the venue's minimum spend floor.";
    } else if (o.status === "no_fit") {
      outcome = "auto-decline";
      title = `${venue} · not a fit`;
      detail = `Not quoted: ${str(o.reason) ?? "no fit"}.`;
    }
    return {
      id: `${t.traceId}:${s.spanId}:${i}`,
      at,
      kind: "negotiation",
      outcome,
      agent: "rfp-broadcaster",
      title,
      detail,
      durationMs: null,
      tokens: null,
      traceId: t.traceId,
      facts: shared,
    } satisfies ObservabilityEvent;
  });
}

function fromHostResponse(t: TraceRecord, s: SpanRecord): ObservabilityEvent {
  const declined = s.attributes.intent === "decline";
  const refused = s.attributes.decision === "deny";
  const response = str(s.attributes.response);
  const offer = `${inr(s.attributes.perHeadInr)}/head`;
  return {
    id: `${t.traceId}:${s.spanId}`,
    at: new Date(s.start).toISOString(),
    kind: "negotiation",
    outcome: refused ? "auto-decline" : s.status === "error" ? "fallback" : "success",
    agent: "host",
    title: declined ? "Host declined an RFP" : refused ? `Host counter at ${offer} refused` : `Host countered at ${offer}`,
    detail: refused
      ? (s.error?.message ?? "Below the venue's floor or past its discount ceiling.")
      : s.status === "error"
        ? (s.error?.message ?? "Response not saved")
        : declined
          ? "Sent from the RFP inbox on /property."
          : "Final price for this client; no rate card applied on top.",
    durationMs: s.durationMs,
    tokens: null,
    traceId: t.traceId,
    facts: response ? [["response", response]] : [],
    manual: true,
  };
}

/** A 503 from an AI route that never reached the model: no run was logged, so only the trace knows. */
function fromRefusedRoute(t: TraceRecord): ObservabilityEvent | null {
  const root = t.spans[0];
  const agent = ROUTE_AGENT[t.name];
  if (!root || !agent || root.attributes["http.status"] !== 503) return null;
  if (t.spans.some((s) => s.name.startsWith("llm."))) return null; // reached the model: the run log has it
  return {
    id: `${t.traceId}:refused`,
    at: new Date(t.start).toISOString(),
    kind: "prompt",
    outcome: "fallback",
    agent,
    title: `${t.name.replace(/^api\./, "/api/").replaceAll(".", "/")} refused before calling the model`,
    detail: "Answered 503: no AI key, the circuit was open, or a prerequisite (agent switched off, live database) was missing.",
    durationMs: t.durationMs,
    tokens: null,
    traceId: t.traceId,
    facts: [["status", "503"]],
    fallback: FALLBACK_PATH[agent],
  };
}

function fromTrace(t: TraceRecord): ObservabilityEvent[] {
  const out: ObservabilityEvent[] = [];
  const refused = fromRefusedRoute(t);
  if (refused) out.push(refused);
  for (const s of t.spans) {
    if (s.name.startsWith("guardrail.")) out.push(fromGuardrail(t, s));
    else if (s.name === "rfp.broadcast") out.push(...fromBroadcast(t, s));
    else if (s.name === "negotiation.respond") out.push(fromHostResponse(t, s));
  }
  return out;
}

/** Newest first. Either log failing leaves the other rendering; `errors` says why. */
export async function getObservabilityFeed(limit = 200) {
  const errors: string[] = [];
  const [runs, traces] = await Promise.all([
    listAgentRuns(300).catch((err): LoggedRun[] => {
      console.error("agents: could not load the run log", err);
      errors.push("run log unavailable");
      return [];
    }),
    tracer.listTraces({ limit: TRACE_LIST_LIMIT }).catch((err): TraceRecord[] => {
      console.error("agents: could not load traces", err);
      errors.push("trace log unavailable");
      return [];
    }),
  ]);
  const events = [...runs.map(fromRun), ...traces.flatMap(fromTrace)].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  return { events, errors };
}

/** Guardrail decisions (allowed, refused, failed) from recorded traces, newest first. */
export async function listGuardrailEvents(limit = 200): Promise<ObservabilityEvent[]> {
  const traces = await listTraces();
  return traces
    .flatMap((t) => t.spans.filter((s) => s.name.startsWith("guardrail.")).map((s) => fromGuardrail(t, s)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/**
 * The AI provider panel: circuit state and counters for the LLM breaker across
 * every instance (last 24 h), merged with this instance's live breaker so the
 * page is right even before its own events are flushed. If the shared store
 * can't be read, this instance's numbers are shown and `store` says so.
 */
export async function providerHealth(events: ObservabilityEvent[], now = Date.now()): Promise<ProviderHealth> {
  const store = appProviderHealthStore();
  const local = llmCircuitBreaker.snapshot();
  const shared = await store.read(llmCircuitBreaker.name, now).catch((err): SharedProviderHealth | null => {
    console.error("agents: provider health store unavailable; showing this instance only", err);
    return null;
  });
  const self = { instance: instanceId(), state: local.state, consecutiveFailures: local.consecutiveFailures, retryAt: local.retryAt, at: now };
  const instances = [self, ...(shared?.instances.filter((i) => i.instance !== self.instance) ?? [])];
  const worst = combinedCircuit(instances, now);
  const stats = shared?.stats24h ?? local.stats;
  const since = new Date(now - 86_400_000).toISOString();
  return {
    configured: isBackendConfigured(DEFAULT_BACKEND),
    backends: MODEL_BACKENDS.map((id) => ({ id, label: MODEL_BACKEND_LABEL[id], configured: isBackendConfigured(id) })),
    circuit: worst?.state ?? "CLOSED",
    consecutiveFailures: worst?.consecutiveFailures ?? local.consecutiveFailures,
    retryAt: worst?.retryAt ?? null,
    stats: { calls: stats.calls, failures: stats.failures, rejected: stats.rejected, retries: stats.retries },
    fallbacks24h: events.filter((e) => e.outcome === "fallback" && e.at >= since).length,
    store: shared ? store.source : "instance",
    instances: instances.length,
    degradedInstances: instances.filter((i) => combinedCircuit([i], now)).length,
    transitions: (shared?.transitions ?? []).slice(0, 5),
  };
}

/** Rule thresholds for the guardrail inspector, read from the same constants the engine enforces. */
export function guardrailInventory() {
  const { booking, minimumSpend, menuPackage } = GUARDRAIL_LIMITS;
  return [
    {
      tool: "Venue negotiation rules",
      agent: "Set per venue by the host",
      surface: "/property",
      gate: "Every manual counter, direct quote, AI negotiator change and new RFP",
      rules: [
        ["Minimum spend floor", "Pre-GST total no offer may go below (blank = none)"],
        ["Maximum discount", `Off the venue's own per-head price, 0–${MAX_DISCOUNT_CAP}% (blank = none)`],
        ["Auto-counter", "Over-budget RFPs are countered at the client's budget when that stays within the floor and discount ceiling"],
        ["Auto-decline", "RFPs whose budget can't reach the floor are declined (needs a floor)"],
      ],
    },
    {
      tool: "setMinimumSpend",
      agent: "Property negotiator",
      surface: "/property",
      gate: "Host approval (HMAC-signed), then guardrail",
      rules: [
        ["Largest change per approved call", `±${Math.round(minimumSpend.maxChangeFraction * 100)}% of the current minimum spend`],
        ["Absolute range", `${formatINR(0)} – ${formatINR(10_000_000)} pre-GST (schema)`],
        ["From a zero minimum spend", "Only the absolute range applies"],
      ],
    },
    {
      tool: "upsertMenuPackage",
      agent: "Property negotiator",
      surface: "/property",
      gate: "Host approval (HMAC-signed), then guardrail",
      rules: [
        ["Per-head price", `${formatINR(menuPackage.minPerHeadInr)} – ${formatINR(menuPackage.maxPerHeadInr)}`],
        ["Last active package", "Can't be deactivated"],
        ["Package id", "Must belong to this venue"],
      ],
    },
    {
      tool: "createBooking",
      agent: "Channel concierge",
      surface: "WhatsApp · Slack",
      gate: "Guardrail only (linked senders)",
      rules: [
        ["Sender", "Must be linked to a portal user"],
        ["Requests per sender", `${booking.perSenderPerHour} per rolling hour`],
        ["Booking horizon", `Up to ${booking.maxDaysAhead} days ahead`],
        ["Duplicate venue + date", `Refused for ${booking.duplicateWindowHours} h`],
      ],
    },
  ] as const;
}

/** Deterministic pricing rules behind instant quotes (lib/quotes, lib/rates). No model sets a price. */
export const PRICING_RULES: [string, string][] = [
  ["Minimum spend", "Every quote is lifted to the venue's minimum spend, or the rate card's override when one is in force."],
  ["Package choice", "The dearest active package covering every dietary need within the per-head ask; the cheapest eligible one when none fits."],
  ["Over budget", "If the venue has auto-counter or auto-decline on, its negotiation rules decide (Auto-Counter / Auto-Decline); otherwise the instant quote stands for the host."],
  ["Rate-card discount", "0–100% off the package price (database check). A custom per-head rate replaces the discount."],
  ["No fit", "Too small, no private dining room when required, or no package covers the dietary needs. Shows as Auto-Decline."],
  ["GST", "Added after pricing; never by the model."],
];
