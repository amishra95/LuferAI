import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";

const ENV_FILE = path.join(process.cwd(), ".env.local");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Settings may only write .env.local from `next dev` on this machine: there is
 * no sign-in, and a deployed or LAN-reachable server must never accept keys
 * from a web form. Elsewhere, keys are set in the hosting provider's env.
 */
export async function canEditEnvFile(): Promise<boolean> {
  if (process.env.NODE_ENV !== "development") return false;
  const host = (await headers()).get("host") ?? "";
  return LOCAL_HOSTS.has(host.replace(/:\d+$/, ""));
}

/** Keys defined in .env.local (values untouched). */
export async function envFileKeys(): Promise<Set<string>> {
  const text = await readFile(ENV_FILE, "utf8").catch(() => "");
  return new Set([...text.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]));
}

/**
 * Sets (string) or removes (null) keys in .env.local, keeping every other line
 * as-is, and mirrors the change into process.env so it applies immediately.
 */
export async function updateEnvFile(updates: Record<string, string | null>): Promise<void> {
  const text = await readFile(ENV_FILE, "utf8").catch(() => "");
  const lines = text ? text.replace(/\n$/, "").split("\n") : [];
  const pending = new Map(Object.entries(updates));

  const next = lines.flatMap((line) => {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    if (!key || !pending.has(key)) return [line];
    const value = pending.get(key)!;
    pending.delete(key);
    return value === null ? [] : [`${key}=${value}`];
  });
  for (const [key, value] of pending) if (value !== null) next.push(`${key}=${value}`);

  await writeFile(ENV_FILE, next.length ? `${next.join("\n")}\n` : "", { mode: 0o600 });

  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
}

/** "sk-…a1b2" — enough to recognise a key without exposing it. */
export function maskSecret(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return `${v.slice(0, 3)}…${v.slice(-4)}`;
}
