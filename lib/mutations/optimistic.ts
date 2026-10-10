/**
 * Optimistic state: the server's value (`base`) plus a queue of pending
 * changes. What the UI shows is every pending change applied to the base, so:
 *
 * - a change shows the moment it's made;
 * - on success it's folded into the base (optionally reconciled with what the
 *   server returned) and leaves the queue;
 * - on failure it just leaves the queue. That's the rollback, and it can't
 *   clobber another change made meanwhile (restoring a snapshot would);
 * - new server data (a refresh after revalidation) replaces the base while
 *   pending changes stay applied on top.
 *
 * Pure: the useOptimisticMutation hook (components/workspace/
 * use-optimistic-mutation.ts) wraps it; tests drive it directly
 * (tests/mutations.test.mjs).
 */

export interface OptimisticChange<S, R> {
  /** The change as the user expects it. */
  apply: (state: S) => S;
  /** The request. A throw (or rejected promise) rolls the change back. */
  run: () => Promise<R>;
  /** On success, the base becomes this (default: `apply` on the base). */
  commit?: (base: S, result: R) => S;
}

export type MutationOutcome<R> = { ok: true; result: R } | { ok: false; error: unknown };

export interface OptimisticState<S> {
  /** Base with every pending change applied. */
  view(): S;
  base(): S;
  pending(): number;
  /** New server truth; pending changes stay on top. */
  setBase(base: S): void;
  mutate<R>(change: OptimisticChange<S, R>): Promise<MutationOutcome<R>>;
  subscribe(listener: () => void): () => void;
}

export function createOptimisticState<S>(initial: S): OptimisticState<S> {
  let base = initial;
  let queue: { id: number; apply: (s: S) => S }[] = [];
  let nextId = 1;
  let view = initial;
  const listeners = new Set<() => void>();

  const recompute = () => {
    const next = queue.reduce((s, c) => c.apply(s), base);
    if (Object.is(next, view)) return;
    view = next;
    for (const l of listeners) l();
  };

  return {
    view: () => view,
    base: () => base,
    pending: () => queue.length,
    setBase(next) {
      base = next;
      recompute();
    },
    async mutate<R>(change: OptimisticChange<S, R>): Promise<MutationOutcome<R>> {
      const id = nextId++;
      queue = [...queue, { id, apply: change.apply }];
      recompute();
      try {
        const result = await change.run();
        base = change.commit ? change.commit(base, result) : change.apply(base);
        queue = queue.filter((c) => c.id !== id);
        recompute();
        return { ok: true, result };
      } catch (error) {
        queue = queue.filter((c) => c.id !== id);
        recompute();
        return { ok: false, error };
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A user-facing message for a failed mutation. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  return error instanceof Error && error.name === "ActionError" && error.message ? error.message : fallback;
}
