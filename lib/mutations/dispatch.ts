/**
 * The shape every mutation (server action) returns, and the dispatcher that
 * produces it: run the work, publish telemetry only when it succeeded, and turn
 * failures into a message the UI can show. Mutations return failures instead
 * of throwing so the client can roll back and say why without Next's error
 * overlay; framework control flow (redirects, notFound) is re-thrown.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/mutations.test.mjs).
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A failure whose message is safe and useful to show the user. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

export const GENERIC_ERROR = "Something went wrong. Try again.";

export interface DispatchOptions<T> {
  /** Telemetry for a successful mutation. Its failure is logged, never surfaced. */
  emit?: (data: T) => unknown;
  /** Re-throws framework errors (pass next/navigation's unstable_rethrow). */
  rethrow?: (err: unknown) => void;
  log?: (message: string, err: unknown) => void;
}

export async function dispatch<T>(name: string, run: () => T | Promise<T>, { emit, rethrow, log = console.error }: DispatchOptions<T> = {}): Promise<ActionResult<T>> {
  let data: T;
  try {
    data = await run();
  } catch (err) {
    rethrow?.(err);
    if (err instanceof ActionError) return { ok: false, error: err.message };
    log(`${name}: failed`, err);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (emit) {
    try {
      await emit(data);
    } catch (err) {
      log(`${name}: telemetry failed`, err);
    }
  }
  return { ok: true, data };
}

/** Client side: a failed result → a thrown Error (for the optimistic runner to roll back on). */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new ActionError(result.error);
  return result.data;
}
