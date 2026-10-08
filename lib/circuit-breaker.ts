/**
 * Circuit breaker with retries, for calls to flaky upstreams (LLM providers,
 * third-party APIs).
 *
 *   CLOSED     calls pass through. Transient errors (429, 5xx, timeouts, network)
 *              are retried with exponential backoff and full jitter, honouring
 *              Retry-After. A call that still fails counts once; `failureThreshold`
 *              consecutive failures open the circuit.
 *   OPEN       calls fail fast with CircuitOpenError (or return the fallback)
 *              until `resetTimeoutMs` has passed.
 *   HALF_OPEN  up to `halfOpenMaxCalls` trial calls run, without retries.
 *              `successThreshold` successes close the circuit; any failure
 *              reopens it.
 *
 * Client errors (other 4xx: bad request, auth) are the caller's problem, not
 * the upstream's: they are neither retried nor counted toward opening.
 *
 * State is per process. On Fluid Compute an instance serves many requests, so
 * this still sheds load from a failing provider, but separate instances trip
 * independently.
 *
 * No server-only imports or path aliases, so tests can import it directly
 * (tests/circuit-breaker.test.mjs).
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface RetryOptions {
  /** Extra attempts after the first, for transient errors (CLOSED only). */
  maxRetries: number;
  /** Backoff ceiling doubles from this per attempt: base, 2·base, 4·base… */
  baseDelayMs: number;
  /** Upper bound for any single wait, including a server's Retry-After. */
  maxDelayMs: number;
}

export interface CircuitBreakerOptions {
  name: string;
  /** Consecutive failed calls (after retries) that open the circuit. */
  failureThreshold: number;
  /** How long the circuit stays OPEN before allowing trial calls. */
  resetTimeoutMs: number;
  /** Concurrent trial calls allowed while HALF_OPEN. */
  halfOpenMaxCalls: number;
  /** Successful trial calls needed to close again. */
  successThreshold: number;
  retry: RetryOptions;
  /** Aborts an attempt that runs longer than this; the timeout counts as transient. */
  callTimeoutMs?: number;
  /** Worth retrying? Default: 429, 5xx, timeouts and network errors. */
  isTransient?: (error: unknown) => boolean;
  /** Counts toward opening the circuit? Default: same as isTransient. */
  isFailure?: (error: unknown) => boolean;
  onStateChange?: (event: { name: string; from: CircuitState; to: CircuitState; at: number }) => void;
  /** Injectable for tests. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface ExecuteOptions<T> {
  /**
   * Returned instead of throwing when the circuit rejects the call or the call
   * finally fails. Errors it throws propagate.
   */
  fallback?: (error: unknown) => T | Promise<T>;
  /** Cancels the call and any pending backoff. */
  signal?: AbortSignal;
}

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  /** When an OPEN circuit will allow trial calls (epoch ms), else null. */
  retryAt: number | null;
  stats: { calls: number; successes: number; failures: number; rejected: number; retries: number; fallbacks: number };
}

/** Thrown (or passed to the fallback) when the circuit refuses a call. */
export class CircuitOpenError extends Error {
  readonly circuit: string;
  readonly retryAt: number | null;
  constructor(circuit: string, retryAt: number | null) {
    super(
      retryAt
        ? `Circuit "${circuit}" is open; retry after ${new Date(retryAt).toISOString()}.`
        : `Circuit "${circuit}" is half-open and already at its trial-call limit.`
    );
    this.name = "CircuitOpenError";
    this.circuit = circuit;
    this.retryAt = retryAt;
  }
}

/** Thrown when an attempt exceeds `callTimeoutMs`. */
export class CallTimeoutError extends Error {
  constructor(ms: number) {
    super(`Call timed out after ${ms} ms.`);
    this.name = "CallTimeoutError";
  }
}

// ----------------------------------------------------------------------------
// Error classification
// ----------------------------------------------------------------------------

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown; headers?: unknown };
  responseHeaders?: unknown;
  headers?: unknown;
  retryAfter?: unknown;
  cause?: unknown;
};

const asObject = (e: unknown): ErrorLike | null => (typeof e === "object" && e !== null ? (e as ErrorLike) : null);

/** HTTP status from the shapes fetch wrappers and SDKs use (AI SDK APICallError: statusCode), or from "(503)" in the message. */
export function statusOf(error: unknown): number | null {
  const e = asObject(error);
  if (!e) return null;
  for (const v of [e.status, e.statusCode, e.response?.status]) {
    if (typeof v === "number" && v >= 100 && v < 600) return v;
  }
  const m = typeof e.message === "string" ? /\((\d{3})\)/.exec(e.message) : null;
  return m ? Number(m[1]) : null;
}

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

/** 429, 5xx, timeouts and network failures. Aborts by the caller are not transient. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof CircuitOpenError) return false;
  if (error instanceof CallTimeoutError) return true;
  const e = asObject(error);
  if (!e) return false;
  if (e.name === "AbortError") return false;
  const status = statusOf(error);
  if (status !== null) return status === 408 || status === 429 || status >= 500;
  if (typeof e.code === "string" && NETWORK_CODES.has(e.code)) return true;
  // undici: TypeError("fetch failed") with the socket error as `cause`.
  if (e.name === "TypeError" && e.message === "fetch failed") return true;
  return e.cause !== undefined && e.cause !== error ? isTransientError(e.cause) : false;
}

function header(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  if (typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (k.toLowerCase() === name && typeof v === "string") return v;
    }
  }
  return null;
}

/** Server-requested wait in ms (Retry-After seconds or HTTP date, or a numeric `retryAfter` in seconds), else null. */
export function retryAfterMs(error: unknown, now: number): number | null {
  const e = asObject(error);
  if (!e) return null;
  if (typeof e.retryAfter === "number" && e.retryAfter >= 0) return e.retryAfter * 1000;
  const raw = header(e.responseHeaders, "retry-after") ?? header(e.headers, "retry-after") ?? header(e.response?.headers, "retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

// ----------------------------------------------------------------------------

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export class CircuitBreaker {
  readonly name: string;
  private readonly opts: Required<Omit<CircuitBreakerOptions, "callTimeoutMs" | "onStateChange">> &
    Pick<CircuitBreakerOptions, "callTimeoutMs" | "onStateChange">;

  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;
  private halfOpenSuccesses = 0;
  private readonly stats = { calls: 0, successes: 0, failures: 0, rejected: 0, retries: 0, fallbacks: 0 };

  constructor(options: CircuitBreakerOptions) {
    if (options.failureThreshold < 1 || options.successThreshold < 1 || options.halfOpenMaxCalls < 1) {
      throw new RangeError("failureThreshold, successThreshold and halfOpenMaxCalls must be at least 1");
    }
    if (options.retry.maxRetries < 0 || options.retry.baseDelayMs < 0 || options.retry.maxDelayMs < options.retry.baseDelayMs) {
      throw new RangeError("retry needs maxRetries ≥ 0 and 0 ≤ baseDelayMs ≤ maxDelayMs");
    }
    const isTransient = options.isTransient ?? isTransientError;
    this.name = options.name;
    this.opts = {
      ...options,
      isTransient,
      isFailure: options.isFailure ?? isTransient,
      now: options.now ?? Date.now,
      sleep: options.sleep ?? defaultSleep,
      random: options.random ?? Math.random,
    };
  }

  /**
   * Runs `fn` through the breaker. `fn` receives an AbortSignal that fires on
   * the per-attempt timeout or when the caller's signal aborts; pass it on to
   * fetch / the AI SDK so abandoned attempts stop.
   */
  async execute<T>(fn: (signal: AbortSignal) => Promise<T>, options: ExecuteOptions<T> = {}): Promise<T> {
    this.stats.calls++;
    const admitted = this.admit();
    if (admitted !== "ok") {
      this.stats.rejected++;
      return this.fail(admitted, options);
    }

    const trial = this.state === "HALF_OPEN";
    if (trial) this.halfOpenInFlight++;
    try {
      const result = await this.withRetries(fn, trial, options.signal);
      this.onSuccess(trial);
      return result;
    } catch (error) {
      // A caller abort says nothing about the upstream's health.
      if (!options.signal?.aborted && this.opts.isFailure(error)) this.onFailure(trial);
      return this.fail(error, options);
    } finally {
      if (trial) this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
    }
  }

  /** Current state, moving OPEN → HALF_OPEN if the reset timeout has passed. */
  getState(): CircuitState {
    this.refresh();
    return this.state;
  }

  snapshot(): CircuitSnapshot {
    this.refresh();
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      retryAt: this.state === "OPEN" ? this.openedAt + this.opts.resetTimeoutMs : null,
      stats: { ...this.stats },
    };
  }

  /** Back to CLOSED with counters cleared (e.g. after fixing a bad key). Stats are kept. */
  reset() {
    this.consecutiveFailures = 0;
    this.halfOpenSuccesses = 0;
    this.transition("CLOSED");
  }

  // --------------------------------------------------------------------------

  private refresh() {
    if (this.state === "OPEN" && this.opts.now() - this.openedAt >= this.opts.resetTimeoutMs) {
      this.halfOpenSuccesses = 0;
      this.transition("HALF_OPEN");
    }
  }

  private admit(): "ok" | CircuitOpenError {
    this.refresh();
    if (this.state === "OPEN") return new CircuitOpenError(this.name, this.openedAt + this.opts.resetTimeoutMs);
    if (this.state === "HALF_OPEN" && this.halfOpenInFlight >= this.opts.halfOpenMaxCalls) return new CircuitOpenError(this.name, null);
    return "ok";
  }

  private async withRetries<T>(fn: (signal: AbortSignal) => Promise<T>, trial: boolean, signal?: AbortSignal): Promise<T> {
    const { maxRetries, baseDelayMs, maxDelayMs } = this.opts.retry;
    // Trial calls probe the upstream once; retrying them would hammer it while it recovers.
    const attempts = trial ? 1 : maxRetries + 1;
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await this.attempt(fn, signal);
      } catch (error) {
        const last = attempt + 1 >= attempts;
        // Another call may have opened the circuit meanwhile: stop retrying into it.
        if (last || signal?.aborted || this.state === "OPEN" || !this.opts.isTransient(error)) throw error;
        // Full jitter: uniform in [0, min(max, base·2^attempt)], but never sooner than Retry-After.
        const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        const requested = retryAfterMs(error, this.opts.now());
        const delay = Math.min(maxDelayMs, Math.max(requested ?? 0, Math.round(this.opts.random() * ceiling)));
        this.stats.retries++;
        await this.opts.sleep(delay, signal);
      }
    }
  }

  private async attempt<T>(fn: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
    const { callTimeoutMs } = this.opts;
    if (!callTimeoutMs) return fn(outer ?? new AbortController().signal);

    const ctrl = new AbortController();
    const timeout = new CallTimeoutError(callTimeoutMs);
    const onOuterAbort = () => ctrl.abort(outer!.reason);
    outer?.addEventListener("abort", onOuterAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(ctrl.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            ctrl.abort(timeout);
            reject(timeout);
          }, callTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  }

  private onSuccess(trial: boolean) {
    this.stats.successes++;
    this.consecutiveFailures = 0;
    if (trial && this.state === "HALF_OPEN" && ++this.halfOpenSuccesses >= this.opts.successThreshold) {
      this.transition("CLOSED");
    }
  }

  private onFailure(trial: boolean) {
    this.stats.failures++;
    this.consecutiveFailures++;
    if ((trial && this.state === "HALF_OPEN") || (this.state === "CLOSED" && this.consecutiveFailures >= this.opts.failureThreshold)) {
      this.openedAt = this.opts.now();
      this.transition("OPEN");
    }
  }

  private async fail<T>(error: unknown, options: ExecuteOptions<T>): Promise<T> {
    if (!options.fallback) throw error;
    this.stats.fallbacks++;
    return options.fallback(error);
  }

  private transition(to: CircuitState) {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    if (to !== "HALF_OPEN") this.halfOpenSuccesses = 0;
    try {
      this.opts.onStateChange?.({ name: this.name, from, to, at: this.opts.now() });
    } catch {
      // A broken listener must not break the call path.
    }
  }
}

// ----------------------------------------------------------------------------
// Shared breaker for LLM / AI API calls
// ----------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __luferLlmCircuitBreaker?: CircuitBreaker };

/**
 * One breaker for model calls (OpenAI via the AI SDK, AI Gateway). Kept on
 * globalThis so `next dev` hot reloads don't reset its state.
 *
 * Tuned for LLM latency: up to 3 retries with 0.5 s → 8 s backoff (Retry-After
 * honoured up to 8 s), a 60 s per-attempt timeout matching the routes'
 * maxDuration, opening after 5 consecutive failed calls for 30 s, then closing
 * after 2 successful trial calls.
 *
 * The AI SDK also retries internally (maxRetries, default 2). When wrapping
 * generateText/streamText, pass `maxRetries: 0` so attempts don't multiply.
 */
export const llmCircuitBreaker: CircuitBreaker = (g.__luferLlmCircuitBreaker ??= new CircuitBreaker({
  name: "llm",
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxCalls: 1,
  successThreshold: 2,
  retry: { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 8_000 },
  callTimeoutMs: 60_000,
  onStateChange: ({ name, from, to }) => {
    const log = to === "OPEN" ? console.error : console.warn;
    log(`circuit-breaker: "${name}" ${from} → ${to}`);
  },
}));
