/**
 * Token usage and spend for the /agents dashboard, from agent_execution_logs
 * rows (one per model call). Pure, with no path aliases, so tests can import it
 * directly (tests/agent-observability.test.mjs).
 */

export interface UsageLog {
  agentKey: string;
  model: string;
  source: string;
  promptTokens: number;
  completionTokens: number;
  /** USD; null when the model's price isn't known. */
  cost: number | null;
  /** ISO time. */
  executedAt: string;
}

export interface SpendTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  /** Calls whose model has no listed price (their cost isn't in `cost`). */
  unpriced: number;
}

export interface SpendSummary {
  /** Rolling windows ending now. */
  last24h: SpendTotals;
  last7d: SpendTotals;
  last30d: SpendTotals;
  /** Last 30 days, most expensive first. */
  byAgent: ({ agentKey: string } & SpendTotals)[];
  byModel: ({ model: string } & SpendTotals)[];
  /** Cost per IST calendar day, oldest first, for the last 14 days (zero-filled). */
  daily: { day: string; cost: number; tokens: number }[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IST_OFFSET = 5.5 * HOUR;

const empty = (): SpendTotals => ({ calls: 0, promptTokens: 0, completionTokens: 0, cost: 0, unpriced: 0 });

function add(t: SpendTotals, log: UsageLog) {
  t.calls += 1;
  t.promptTokens += log.promptTokens;
  t.completionTokens += log.completionTokens;
  if (log.cost === null) t.unpriced += 1;
  else t.cost += log.cost;
}

const round = (t: SpendTotals): SpendTotals => ({ ...t, cost: Math.round(t.cost * 1e6) / 1e6 });

/** YYYY-MM-DD of an epoch ms in India time. */
export const istDay = (ms: number) => new Date(ms + IST_OFFSET).toISOString().slice(0, 10);

export function summarizeSpend(logs: readonly UsageLog[], now = Date.now()): SpendSummary {
  const last24h = empty();
  const last7d = empty();
  const last30d = empty();
  const agents = new Map<string, SpendTotals>();
  const models = new Map<string, SpendTotals>();
  const days = new Map<string, { cost: number; tokens: number }>();
  for (let i = 13; i >= 0; i--) days.set(istDay(now - i * DAY), { cost: 0, tokens: 0 });

  for (const log of logs) {
    const at = Date.parse(log.executedAt);
    if (Number.isNaN(at) || at > now) continue;
    const age = now - at;
    if (age > 30 * DAY) continue;
    add(last30d, log);
    if (age <= 7 * DAY) add(last7d, log);
    if (age <= DAY) add(last24h, log);
    add(agents.get(log.agentKey) ?? agents.set(log.agentKey, empty()).get(log.agentKey)!, log);
    add(models.get(log.model) ?? models.set(log.model, empty()).get(log.model)!, log);
    const day = days.get(istDay(at));
    if (day) {
      day.cost += log.cost ?? 0;
      day.tokens += log.promptTokens + log.completionTokens;
    }
  }

  const byCost = <T extends SpendTotals>(a: T, b: T) => b.cost - a.cost || b.calls - a.calls;
  return {
    last24h: round(last24h),
    last7d: round(last7d),
    last30d: round(last30d),
    byAgent: [...agents].map(([agentKey, t]) => ({ agentKey, ...round(t) })).sort(byCost),
    byModel: [...models].map(([model, t]) => ({ model, ...round(t) })).sort(byCost),
    daily: [...days].map(([day, d]) => ({ day, cost: Math.round(d.cost * 1e6) / 1e6, tokens: d.tokens })),
  };
}

/** "$0.0042", "$1.27", "$1,204" — enough precision for small per-call costs. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** 1234 → "1.2k", 2_500_000 → "2.5M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
