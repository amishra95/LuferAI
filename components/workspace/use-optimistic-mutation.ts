"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useToast, type ToastInput } from "@/components/dashboard/toast";
import { unwrap, type ActionResult } from "@/lib/mutations/dispatch";
import { createOptimisticState, errorMessage, type MutationOutcome } from "@/lib/mutations/optimistic";

/** Toasts for a mutation: `failure` is the title, the server's reason the description. */
export interface MutationToasts<R> {
  failure: string;
  /** Omit for silent success (the change itself is the feedback). */
  success?: (result: R) => ToastInput | null;
}

export interface OptimisticMutationInput<S, R> extends MutationToasts<R> {
  apply: (state: S) => S;
  /** A server action returning an ActionResult. */
  action: () => Promise<ActionResult<R>>;
  /** The base after success (default: `apply`). */
  commit?: (base: S, result: R) => S;
}

/**
 * Optimistic UI over a server value (lib/mutations/optimistic.ts): the change
 * shows at once, rolls back on failure with an error toast, and the next
 * server render (actions revalidate and refresh) becomes the new base.
 *
 * `serverValue` must keep its identity until the server data really changes
 * (props from a server component, a memo, a state value): each new identity
 * replaces the base, so an inline `[]` or `{…}` would reset it every render.
 *
 *   const { value: agent, mutate } = useOptimisticMutation(props.agent);
 *   mutate({ apply: (a) => ({ ...a, enabled: !a.enabled }), action: () => updateAgentConfig(a.id, { enabled }), failure: "Couldn't update" });
 */
export function useOptimisticMutation<S>(serverValue: S) {
  const [store] = useState(() => createOptimisticState(serverValue));
  useEffect(() => store.setBase(serverValue), [store, serverValue]);
  const value = useSyncExternalStore(store.subscribe, store.view, store.view);
  const [pending, setPending] = useState(0);
  const toast = useToast();

  const mutate = useCallback(
    async <R,>({ apply, action, commit, failure, success }: OptimisticMutationInput<S, R>): Promise<MutationOutcome<R>> => {
      setPending((n) => n + 1);
      const outcome = await store.mutate({ apply, commit, run: async () => unwrap(await action()) });
      setPending((n) => n - 1);
      report(toast, outcome, { failure, success });
      return outcome;
    },
    [store, toast]
  );

  return { value, mutate, pending: pending > 0 };
}

/**
 * A mutation with nothing to show optimistically (a sync, a test run): tracks
 * pending, toasts the outcome. Concurrent calls of the same action are ignored
 * while one is in flight.
 */
export function useAction<R>() {
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const run = useCallback(
    async (action: () => Promise<ActionResult<R>>, toasts: MutationToasts<R>): Promise<MutationOutcome<R> | null> => {
      if (pending) return null;
      setPending(true);
      let outcome: MutationOutcome<R>;
      try {
        outcome = { ok: true, result: unwrap(await action()) };
      } catch (error) {
        outcome = { ok: false, error };
      } finally {
        setPending(false);
      }
      report(toast, outcome, toasts);
      return outcome;
    },
    [pending, toast]
  );
  return { run, pending };
}

function report<R>(toast: (t: ToastInput) => void, outcome: MutationOutcome<R>, { failure, success }: MutationToasts<R>) {
  if (!outcome.ok) {
    toast({ tone: "error", title: failure, description: errorMessage(outcome.error) });
    return;
  }
  const t = success?.(outcome.result);
  if (t) toast(t);
}
