import "server-only";

import { tracer } from "@/lib/tracer";

type ToolLike = { execute?: (input: never, options: never) => unknown };

/**
 * The same tools, with each `execute` run in a `tool.<name>` span that records
 * the (sanitized) input. Schemas, descriptions and approval settings are
 * untouched, so the result drops in wherever the original tools went.
 */
export function traceTools<T extends Record<string, ToolLike>>(tools: T): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const execute = t.execute as ((input: unknown, options: unknown) => unknown) | undefined;
      if (!execute) return [name, t];
      return [name, { ...t, execute: (input: unknown, options: unknown) => tracer.trace(`tool.${name}`, () => execute(input, options), { attributes: { input } }) }];
    })
  ) as T;
}
