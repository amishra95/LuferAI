import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";

import { DEFAULT_BACKEND, type ModelBackend } from "@/lib/agents/config";
import { createLatencyTracker, PROVIDER_LABEL, PROVIDERS, routeOrder, tryInOrder, type Provider, type ProviderStatus } from "@/lib/ai/routing";
import { CircuitOpenError, isTransientError, llmBreakers } from "@/lib/circuit-breaker";
import { trackBreaker } from "@/lib/telemetry/provider-health";
import { logUsage } from "@/lib/telemetry/usage";
import { tracer } from "@/lib/tracer";

// Default models per provider; override per environment (OPENAI_MODEL,
// GROQ_MODEL) rather than editing code when models change.
export const DEFAULT_MODEL = "gpt-4o";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

/**
 * Model calls are routed across providers (lib/ai/routing.ts): an agent's own
 * backend first, the other premium provider next, Groq last, healthiest first.
 * Each provider's HTTP calls go through its own breaker (llmBreakers in
 * lib/circuit-breaker.ts): a retry with backoff on 429 / 5xx / network errors,
 * then fail fast while it's down. When a provider gives up, the router fails
 * over to the next one. For streams this covers the request up to the response
 * headers, where rate limits and outages surface: once a stream has started,
 * an error mid-stream is not retried elsewhere (the user has seen output).
 *
 * When a provider gives up (retries exhausted, or circuit open) it throws
 * AiUnavailableError. It deliberately carries no `cause` chain: the AI SDK would
 * otherwise recognise the network error inside and retry again on its own,
 * multiplying attempts. When every provider gives up, the caller gets the last one.
 */
export class AiUnavailableError extends Error {
  /** When the circuit will allow calls again (epoch ms), if it's open. */
  readonly retryAt: number | null;
  /** Upstream HTTP status of the last attempt, if there was one. */
  readonly upstreamStatus: number | null;
  constructor(message: string, details: { retryAt?: number | null; upstreamStatus?: number | null } = {}) {
    super(message);
    this.name = "AiUnavailableError";
    this.retryAt = details.retryAt ?? null;
    this.upstreamStatus = details.upstreamStatus ?? null;
  }
}

// Counters and transitions go to the shared provider-health store behind /agents.
for (const provider of PROVIDERS) trackBreaker(llmBreakers[provider]);

const gl = globalThis as typeof globalThis & { __luferLatency?: ReturnType<typeof createLatencyTracker> };
/** Time to response headers per provider, smoothed (this instance). */
export const providerLatency = (gl.__luferLatency ??= createLatencyTracker());

const isTransientStatus = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * Each provider request is an `llm.http` span (child of whatever route or step
 * is running): endpoint, final status, attempts made by the breaker and the
 * circuit state. Covers the request up to the response headers.
 */
const resilientFetchFor =
  (provider: Provider): typeof fetch =>
  async (input, init) => {
    const callerSignal = init?.signal ?? undefined;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const breaker = llmBreakers[provider];
    const span = tracer.startSpan("llm.http", { attributes: { provider, "http.path": new URL(url).pathname, "circuit.state": breaker.getState() } });
    const started = Date.now();
    let attempts = 0;
    try {
      const res = await span.run(() => breakerFetch(provider, input, init, callerSignal, () => attempts++));
      span.setAttribute("http.status", res.status);
      if (!res.ok) span.recordError(new Error(`HTTP ${res.status}`));
      providerLatency.record(provider, Date.now() - started);
      return res;
    } catch (err) {
      if (callerSignal?.aborted) span.setAttribute("cancelled", true);
      else {
        span.recordError(err);
        // A slow failure (timeouts) counts toward "slow"; an instant refusal (open circuit) says nothing about latency.
        if (attempts > 0) providerLatency.record(provider, Date.now() - started);
      }
      throw err;
    } finally {
      span.setAttribute("attempts", attempts);
      span.end();
    }
  };

async function breakerFetch(provider: Provider, input: Parameters<typeof fetch>[0], init: RequestInit | undefined, callerSignal: AbortSignal | undefined, onAttempt: () => void) {
  try {
    return await llmBreakers[provider].execute(
      async (attemptSignal) => {
        onAttempt();
        // The caller's signal keeps cancelling the response body after headers arrive.
        const signal = callerSignal ? AbortSignal.any([callerSignal, attemptSignal]) : attemptSignal;
        const res = await fetch(input, { ...init, signal });
        // Success and client errors go back to the SDK as-is (it reports 4xx itself; they don't trip the circuit).
        if (res.ok || !isTransientStatus(res.status)) return res;
        await res.body?.cancel().catch(() => {});
        throw Object.assign(new Error(`Model provider responded ${res.status}`), {
          statusCode: res.status,
          responseHeaders: Object.fromEntries(res.headers),
        });
      },
      { signal: callerSignal }
    );
  } catch (err) {
    if (callerSignal?.aborted) throw err;
    if (err instanceof CircuitOpenError) {
      throw new AiUnavailableError(`${PROVIDER_LABEL[provider]} is unavailable (circuit open).`, { retryAt: err.retryAt });
    }
    if (isTransientError(err)) {
      const status = typeof (err as { statusCode?: unknown }).statusCode === "number" ? (err as { statusCode: number }).statusCode : null;
      throw new AiUnavailableError(`${PROVIDER_LABEL[provider]} is unavailable${status ? ` (${status})` : ""}.`, { upstreamStatus: status });
    }
    throw err;
  }
}

const g = globalThis as typeof globalThis & {
  __luferOpenAI?: ReturnType<typeof createOpenAI>;
  __luferAnthropic?: ReturnType<typeof createAnthropic>;
  __luferGroq?: ReturnType<typeof createGroq>;
};
const openai = () => (g.__luferOpenAI ??= createOpenAI({ fetch: resilientFetchFor("openai") }));
const anthropic = () => (g.__luferAnthropic ??= createAnthropic({ fetch: resilientFetchFor("anthropic") }));
const groq = () => (g.__luferGroq ??= createGroq({ fetch: resilientFetchFor("groq") }));

/** The API key each provider needs. */
const PROVIDER_KEY: Record<Provider, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", groq: "GROQ_API_KEY" };

/** The provider each backend an agent can choose runs on. */
export const BACKEND_PROVIDER: Record<ModelBackend, Provider> = { "gpt-4o": "openai", "claude-sonnet-5-5": "anthropic" };

export const isProviderConfigured = (provider: Provider) => Boolean(process.env[PROVIDER_KEY[provider]]?.trim());

/** Whether the backend's API key is set in this environment. */
export const isBackendConfigured = (backend: ModelBackend) => isProviderConfigured(BACKEND_PROVIDER[backend]);

/** The model id each provider runs. */
export const providerModelId = (provider: Provider) =>
  provider === "anthropic" ? "claude-sonnet-5-5" : provider === "groq" ? process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL : process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

/** Each provider's circuit and latency now, for routing and the /agents health panel. */
export function providerStatuses(): ProviderStatus[] {
  return PROVIDERS.map((provider) => ({ provider, configured: isProviderConfigured(provider), circuit: llmBreakers[provider].getState(), latencyMs: providerLatency.get(provider) }));
}

/** Who a model call is for, so the usage middleware can attribute its tokens. */
export interface UsageContext {
  /** Agent id (lib/agents/config.ts) or run agent (lib/telemetry/runs.ts). */
  agent: string;
  /** Where the call came from: chat, stream, whatsapp, api… */
  source: string;
}

/**
 * Logs each model call's tokens to agent_execution_logs (lib/telemetry/usage.ts).
 * One row per call, so a multi-step agent run writes one row per step.
 */
function usageMiddleware(ctx: UsageContext): LanguageModelMiddleware {
  const log = (modelId: string, usage: { inputTokens: { total: number | undefined }; outputTokens: { total: number | undefined } }) =>
    void logUsage({ agentKey: ctx.agent, model: modelId, source: ctx.source, promptTokens: usage.inputTokens.total ?? 0, completionTokens: usage.outputTokens.total ?? 0 });
  return {
    wrapGenerate: async ({ doGenerate, model }) => {
      const result = await doGenerate();
      log(model.modelId, result.usage);
      return result;
    },
    wrapStream: async ({ doStream, model }) => {
      const { stream, ...rest } = await doStream();
      const counted = stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part.type === "finish") log(model.modelId, part.usage);
            controller.enqueue(part);
          },
        })
      );
      return { stream: counted, ...rest };
    },
  };
}

/**
 * Claude Sonnet 5.5 rejects non-default sampling values, so any temperature is
 * dropped; refusals fall back server-side to another Claude model (fallbacks:
 * "default", the provider adds the beta header).
 */
const claudeDefaults: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    temperature: undefined,
    providerOptions: { ...params.providerOptions, anthropic: { fallbacks: "default", ...params.providerOptions?.anthropic } },
  }),
};

/** One provider's model with its middleware: Claude's defaults, and token logging attributed to the model that ran. */
function providerModel(provider: Provider, usage: UsageContext | undefined): LanguageModelV4 {
  const id = providerModelId(provider);
  const base = provider === "anthropic" ? anthropic()(id) : provider === "groq" ? groq()(id) : openai()(id);
  const middleware = [...(provider === "anthropic" ? [claudeDefaults] : []), ...(usage ? [usageMiddleware(usage)] : [])];
  return middleware.length ? wrapLanguageModel({ model: base, middleware }) : base;
}

/**
 * Tries each provider in route order until one answers. Only "provider
 * unavailable" errors fail over; anything else (a bad request, a cancelled
 * call) is the caller's and is thrown as is. A failover is recorded as an
 * `llm.failover` span so it shows in traces and the /agents activity feed.
 */
async function withFailover<T>(primary: Provider, usage: UsageContext | undefined, signal: AbortSignal | undefined, call: (model: LanguageModelV4) => PromiseLike<T>): Promise<T> {
  const order = routeOrder(primary, providerStatuses());
  if (order.length === 0) throw new AiUnavailableError("No AI provider is configured.");
  const { result, provider, index, errors } = await tryInOrder(order, (p) => call(providerModel(p, usage)), {
    shouldFailOver: isAiUnavailable,
    aborted: () => Boolean(signal?.aborted),
    onSkip: (from, to) => console.warn(`model: ${PROVIDER_LABEL[from]} unavailable, failing over to ${PROVIDER_LABEL[to]}`),
  });
  if (provider !== primary) {
    tracer
      .startSpan("llm.failover", {
        attributes: {
          from: PROVIDER_LABEL[primary],
          to: PROVIDER_LABEL[provider],
          model: providerModelId(provider),
          tried: order.slice(0, index + 1).map((p) => PROVIDER_LABEL[p]).join(" → "),
          agent: usage?.agent ?? null,
          reason: errors.length ? errorText(errors.at(-1)) : `${PROVIDER_LABEL[primary]} skipped: circuit open or slow`,
        },
      })
      .end();
  }
  return result;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "unavailable");

/**
 * The routed model for a backend (default gpt-4o): that backend's provider
 * first, then the others (lib/ai/routing.ts). Null only when no provider has
 * an API key. Pass `usage` to log each call's tokens and cost.
 */
export function getLanguageModel(options: { backend?: ModelBackend; usage?: UsageContext } = {}): LanguageModelV4 | null {
  const primary = BACKEND_PROVIDER[options.backend ?? DEFAULT_BACKEND];
  if (!PROVIDERS.some(isProviderConfigured)) return null;
  // Named after the provider that would answer now, so pages show what's live.
  const first = routeOrder(primary, providerStatuses())[0] ?? primary;
  return {
    specificationVersion: "v4",
    provider: "lufer.router",
    modelId: providerModelId(first),
    // No URL is passed through as-is: the SDK downloads files itself, which every provider accepts.
    supportedUrls: {},
    doGenerate: (callOptions) => withFailover(primary, options.usage, callOptions.abortSignal, (m) => m.doGenerate(callOptions)),
    doStream: (callOptions) => withFailover(primary, options.usage, callOptions.abortSignal, (m) => m.doStream(callOptions)),
  };
}

export const AI_NOT_CONFIGURED = "AI features are not configured: set OPENAI_API_KEY, ANTHROPIC_API_KEY or GROQ_API_KEY for this environment.";

/** 503 message when no provider can serve an agent's backend. */
export const backendNotConfigured = (backend: ModelBackend) =>
  `The ${backend} backend isn't configured and no fallback provider is: set ${PROVIDER_KEY[BACKEND_PROVIDER[backend]]} (or another provider's key) for this environment.`;

export const AI_UNAVAILABLE = "The AI service is temporarily unavailable. Please try again in a minute.";

/** True for errors meaning "the provider is down or the circuit is open", wherever the SDK wrapped them. */
export function isAiUnavailable(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof AiUnavailableError) return true;
  }
  return false;
}

/** Seconds until some provider's circuit admits calls again (at least 1), for Retry-After. */
export function aiRetryAfterSeconds(): number {
  const times = PROVIDERS.filter(isProviderConfigured)
    .map((p) => llmBreakers[p].snapshot().retryAt)
    .filter((t): t is number => t !== null);
  return times.length ? Math.max(1, Math.ceil((Math.min(...times) - Date.now()) / 1000)) : 30;
}

/** 503 fallback for AI routes: provider down or circuit open. */
export function aiUnavailableResponse(): Response {
  return Response.json({ error: AI_UNAVAILABLE }, { status: 503, headers: { "Retry-After": String(aiRetryAfterSeconds()) } });
}

/** Fast path: skip the work entirely while every configured provider's circuit is open. */
export const aiCircuitOpen = () => {
  const configured = PROVIDERS.filter(isProviderConfigured);
  return configured.length > 0 && configured.every((p) => llmBreakers[p].getState() === "OPEN");
};
