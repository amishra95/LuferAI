/**
 * Multi-model routing: which providers a model call tries, in what order.
 *
 * Tiers, from an agent's chosen backend:
 *   1. its own provider (OpenAI for gpt-4o, Anthropic for Claude Sonnet 5.5)
 *   2. the other premium provider
 *   3. Groq, the fast tier (open-weight model, cheaper, weaker at long tool use)
 *
 * Within that order, providers that are healthy go first: a provider whose
 * circuit is open (lib/circuit-breaker.ts) goes last, where it fails fast, and
 * one whose recent latency spiked goes after the healthy ones. Unconfigured
 * providers (no API key) are skipped.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/model-routing-escalations.test.mjs).
 */
import type { CircuitState } from "../circuit-breaker.ts";

export const PROVIDERS = ["openai", "anthropic", "groq"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABEL: Record<Provider, string> = { openai: "OpenAI", anthropic: "Anthropic", groq: "Groq" };

/** Tier of each provider: premium backends agents choose, then the fast fallback. */
export const PROVIDER_TIER: Record<Provider, "premium" | "fast"> = { openai: "premium", anthropic: "premium", groq: "fast" };

/** Default for "recent latency is a spike": time to response headers, smoothed. */
export const LATENCY_SPIKE_MS = 12_000;

export interface ProviderStatus {
  provider: Provider;
  configured: boolean;
  circuit: CircuitState;
  /** Smoothed time to response headers, or null before any call. */
  latencyMs: number | null;
}

/** Primary first, the other premium provider next, the fast tier last. */
export function tierOrder(primary: Provider): Provider[] {
  const premium = PROVIDERS.filter((p) => PROVIDER_TIER[p] === "premium" && p !== primary);
  const fast = PROVIDERS.filter((p) => PROVIDER_TIER[p] === "fast" && p !== primary);
  return [primary, ...premium, ...fast];
}

export type Health = "healthy" | "slow" | "open";

export function healthOf(s: Pick<ProviderStatus, "circuit" | "latencyMs">, latencySpikeMs = LATENCY_SPIKE_MS): Health {
  if (s.circuit === "OPEN") return "open";
  if (s.latencyMs !== null && s.latencyMs > latencySpikeMs) return "slow";
  return "healthy";
}

const RANK: Record<Health, number> = { healthy: 0, slow: 1, open: 2 };

/** The providers to try, in order. Empty when none is configured. */
export function routeOrder(primary: Provider, statuses: ProviderStatus[], latencySpikeMs = LATENCY_SPIKE_MS): Provider[] {
  const byProvider = new Map(statuses.map((s) => [s.provider, s]));
  return tierOrder(primary)
    .map((p, tier) => ({ p, tier, s: byProvider.get(p) }))
    .filter((c): c is { p: Provider; tier: number; s: ProviderStatus } => Boolean(c.s?.configured))
    .sort((a, b) => RANK[healthOf(a.s, latencySpikeMs)] - RANK[healthOf(b.s, latencySpikeMs)] || a.tier - b.tier)
    .map((c) => c.p);
}

/**
 * Smoothed latency per provider (exponentially weighted: each sample moves the
 * average `alpha` of the way). A failure that took long counts as a sample too,
 * so a provider timing out reads as slow before its circuit opens.
 */
export function createLatencyTracker(alpha = 0.3) {
  const ewma = new Map<Provider, number>();
  return {
    record(provider: Provider, ms: number) {
      if (!Number.isFinite(ms) || ms < 0) return;
      const prev = ewma.get(provider);
      ewma.set(provider, prev === undefined ? ms : prev + alpha * (ms - prev));
    },
    get: (provider: Provider): number | null => {
      const v = ewma.get(provider);
      return v === undefined ? null : Math.round(v);
    },
  };
}

/** How long a provider that refused on account grounds is skipped before it's tried again. */
export const ACCOUNT_BLOCK_MS = 10 * 60_000;

const ACCOUNT_REFUSAL = /no credits remaining|insufficient[_ ]quota|exceeded your current quota|billing|credit balance is too low|invalid[_ ]api[_ ]key|incorrect api key|api key not valid|permission[_ ]denied|account (?:is )?(?:deactivated|suspended)/i;

/**
 * The provider refused because of the account, not the request: out of credits
 * or quota, billing, or a bad/revoked key (401, 402, 403). Retrying the same
 * provider can't help, but another one can. OpenAI reports exhausted credits
 * inside an HTTP 200 stream, so the message counts as much as the status.
 */
export function isProviderAccountError(error: unknown): boolean {
  for (let e = error, depth = 0; typeof e === "object" && e !== null && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const { statusCode, status, message, responseBody } = e as { statusCode?: unknown; status?: unknown; message?: unknown; responseBody?: unknown };
    const code = typeof statusCode === "number" ? statusCode : typeof status === "number" ? status : null;
    if (code === 401 || code === 402 || code === 403) return true;
    if ([message, responseBody].some((t) => typeof t === "string" && ACCOUNT_REFUSAL.test(t))) return true;
  }
  return false;
}

/**
 * Runs `attempt` against each provider in order until one succeeds. Errors
 * that `shouldFailOver` rejects (a bad request, a cancelled call) are thrown
 * at once; the last provider's error is thrown when all fail. Returns the
 * result and the provider that produced it, plus the errors that moved it on.
 */
export async function tryInOrder<T>(
  order: Provider[],
  attempt: (provider: Provider) => PromiseLike<T>,
  options: { shouldFailOver: (error: unknown) => boolean; aborted?: () => boolean; onSkip?: (provider: Provider, next: Provider, error: unknown) => void }
): Promise<{ result: T; provider: Provider; index: number; errors: unknown[] }> {
  if (order.length === 0) throw new Error("No AI provider is configured.");
  const errors: unknown[] = [];
  for (const [index, provider] of order.entries()) {
    try {
      return { result: await attempt(provider), provider, index, errors };
    } catch (error) {
      errors.push(error);
      if (options.aborted?.() || !options.shouldFailOver(error) || index === order.length - 1) throw error;
      options.onSkip?.(provider, order[index + 1], error);
    }
  }
  throw errors.at(-1);
}
