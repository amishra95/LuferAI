// Module hooks for importing server code (actions, workflows, the OAuth vault)
// under Node's test runner: resolves the "@/" alias and
// extensionless TypeScript imports, transforms the TypeScript that strip-only
// mode rejects (parameter properties, enums), and swaps the Next.js runtime, the
// session and workflow/api for stubs. Registered by tests/support/server-actions.mjs.
import { existsSync, readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STUBS = new URL("./server-action-stubs/", import.meta.url);

/** Specifiers replaced outright: no request scope, cache or auth outside Next. */
const STUBBED = {
  "server-only": "empty.mjs",
  "next/cache": "next-cache.mjs",
  "next/navigation": "next-navigation.mjs",
  "@/lib/auth/session": "session.mjs",
  "workflow/api": "workflow-api.mjs",
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();

/** "@/lib/x" or "./x" → the .ts/.tsx/index file it names, as Next's bundler would. */
function locate(base) {
  for (const p of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (isFile(p)) return p;
  return null;
}

export async function resolve(specifier, context, next) {
  if (STUBBED[specifier]) return { url: new URL(STUBBED[specifier], STUBS).href, shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const file = locate(ROOT + specifier.slice(2));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !context.parentURL.includes("/node_modules/")) {
    const file = locate(fileURLToPath(new URL(specifier, context.parentURL)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    // Packages without an exports map ("next/server") resolve to their .js file under the bundler.
    if (err?.code === "ERR_MODULE_NOT_FOUND" && !specifier.startsWith(".") && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context);
    throw err;
  }
}

/** App TypeScript in transform mode: the action graph uses syntax --experimental-strip-types can't erase. */
export async function load(url, context, next) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: stripTypeScriptTypes(source, { mode: "transform", sourceUrl: url }), shortCircuit: true };
  }
  return next(url, context);
}
