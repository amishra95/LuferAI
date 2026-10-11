import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";

import { DEFAULT_BACKEND, type ModelBackend } from "@/lib/agents/config";
import { CircuitOpenError, isTransientError, llmCircuitBreaker } from "@/lib/circuit-breaker";
import { logUsage } from "@/lib/telemetry/usage";
import { tracer } from "@/lib/tracer";

// Default OpenAI text model; override per environment with OPENAI_MODEL
// rather than editing code when models change.
export const DEFAULT_MODEL = "gpt-4o";

/**
 * The model provider's HTTP calls go through llmCircuitBreaker
 * (lib/circuit-breaker.ts), so every generateText / streamText in the app gets
 * retries with backoff on 429 / 5xx / network errors, and fails fast while the
 * provider is down. For streams, the breaker covers the request up to the
 * response headers, which is where rate limits and outages surface.
 *
 * Once retries are exhausted (or the circuit is open) the call throws
 * AiUnavailableError. It deliberately carries no `cause` chain: the AI SDK would
 * otherwise recognise the network error inside and retry again on its own,
 * multiplying attempts.
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

const isTransientStatus = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * Each provider request is an `llm.http` span (child of whatever route or step
 * is running): endpoint, final status, attempts made by the breaker and the
 * circuit state. Covers the request up to the response headers.
 */
const resilientFetch: typeof fetch = async (input, init) => {
  const callerSignal = init?.signal ?? undefined;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const span = tracer.startSpan("llm.http", { attributes: { "http.path": new URL(url).pathname, "circuit.state": llmCircuitBreaker.getState() } });
  let attempts = 0;
  try {
    const res = await span.run(() => breakerFetch(input, init, callerSignal, () => attempts++));
    span.setAttribute("http.status", res.status);
    if (!res.ok) span.recordError(new Error(`HTTP ${res.status}`));
    return res;
  } catch (err) {
    if (callerSignal?.aborted) span.setAttribute("cancelled", true);
    else span.recordError(err);
    throw err;
  } finally {
    span.setAttribute("attempts", attempts);
    span.end();
  }
};

async function breakerFetch(input: Parameters<typeof fetch>[0], init: RequestInit | undefined, callerSignal: AbortSignal | undefined, onAttempt: () => void) {
  try {
    return await llmCircuitBreaker.execute(
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
      throw new AiUnavailableError("The AI provider is unavailable (circuit open).", { retryAt: err.retryAt });
    }
    if (isTransientError(err)) {
      const status = typeof (err as { statusCode?: unknown }).statusCode === "number" ? (err as { statusCode: number }).statusCode : null;
      throw new AiUnavailableError(`The AI provider is unavailable${status ? ` (${status})` : ""}.`, { upstreamStatus: status });
    }
    throw err;
  }
}

const g = globalThis as typeof globalThis & { __luferOpenAI?: ReturnType<typeof createOpenAI>; __luferAnthropic?: ReturnType<typeof createAnthropic> };
const openai = () => (g.__luferOpenAI ??= createOpenAI({ fetch: resilientFetch }));
const anthropic = () => (g.__luferAnthropic ??= createAnthropic({ fetch: resilientFetch }));

/** The API key each backend needs. */
const BACKEND_KEY: Record<ModelBackend, string> = { "gpt-4o": "OPENAI_API_KEY", "claude-sonnet-5-5": "ANTHROPIC_API_KEY" };

/** Whether the backend's API key is set in this environment. */
export const isBackendConfigured = (backend: ModelBackend) => Boolean(process.env[BACKEND_KEY[backend]]?.trim());

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

/**
 * The language model for a backend (default gpt-4o, or OPENAI_MODEL when set),
 * or null when that backend's API key isn't set. Pass `usage` to log each
 * call's tokens and cost.
 */
export function getLanguageModel(options: { backend?: ModelBackend; usage?: UsageContext } = {}) {
  const backend = options.backend ?? DEFAULT_BACKEND;
  if (!isBackendConfigured(backend)) return null;
  const base = backend === "claude-sonnet-5-5" ? anthropic()("claude-sonnet-5-5") : openai()(process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL);
  const middleware = [...(backend === "claude-sonnet-5-5" ? [claudeDefaults] : []), ...(options.usage ? [usageMiddleware(options.usage)] : [])];
  return middleware.length ? wrapLanguageModel({ model: base, middleware }) : base;
}

export const AI_NOT_CONFIGURED = "AI features are not configured: set OPENAI_API_KEY for this environment.";

/** 503 message when an agent's backend has no API key. */
export const backendNotConfigured = (backend: ModelBackend) => `The ${backend} backend isn't configured: set ${BACKEND_KEY[backend]} for this environment.`;

export const AI_UNAVAILABLE = "The AI service is temporarily unavailable. Please try again in a minute.";

/** True for errors meaning "the provider is down or the circuit is open", wherever the SDK wrapped them. */
export function isAiUnavailable(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof AiUnavailableError) return true;
  }
  return false;
}

/** Seconds until the circuit admits calls again (at least 1), for Retry-After. */
export function aiRetryAfterSeconds(): number {
  const at = llmCircuitBreaker.snapshot().retryAt;
  return at ? Math.max(1, Math.ceil((at - Date.now()) / 1000)) : 30;
}

/** 503 fallback for AI routes: provider down or circuit open. */
export function aiUnavailableResponse(): Response {
  return Response.json({ error: AI_UNAVAILABLE }, { status: 503, headers: { "Retry-After": String(aiRetryAfterSeconds()) } });
}

/** Fast path: skip the work entirely while the circuit is open. */
export const aiCircuitOpen = () => llmCircuitBreaker.getState() === "OPEN";
