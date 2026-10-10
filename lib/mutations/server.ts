import "server-only";

import { unstable_rethrow } from "next/navigation";

import { dispatch, type ActionResult, type DispatchOptions } from "@/lib/mutations/dispatch";

export { ActionError, type ActionResult } from "@/lib/mutations/dispatch";

/**
 * dispatch() for server actions: Next's redirects and notFound pass through
 * (an expired session still lands on /login), everything else becomes an
 * ActionResult the client can roll back on.
 */
export function serverDispatch<T>(name: string, run: () => T | Promise<T>, options: Omit<DispatchOptions<T>, "rethrow"> = {}): Promise<ActionResult<T>> {
  return dispatch(name, run, { ...options, rethrow: unstable_rethrow });
}
