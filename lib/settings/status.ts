import "server-only";

import { DEFAULT_MODEL } from "@/lib/ai/model";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import { clean } from "@/lib/supabase/env";
import { canEditEnvFile, envFileKeys, maskSecret } from "@/lib/settings/env-file";

export type OpenAIStatus = {
  configured: boolean;
  maskedKey: string | null;
  model: string;
  modelIsDefault: boolean;
  /** Where the key comes from: .env.local (editable here) or the process environment. */
  source: "env-file" | "environment" | null;
};

export type SupabaseStatus = {
  urlHost: string | null;
  anonKey: boolean;
  serviceRoleKey: boolean;
  configured: boolean;
  ping: { ok: true; latencyMs: number; venues: number } | { ok: false; error: string } | null;
};

export async function getOpenAIStatus(): Promise<OpenAIStatus> {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  const fileKeys = await envFileKeys();
  return {
    configured: Boolean(key),
    maskedKey: maskSecret(key),
    model: model || DEFAULT_MODEL,
    modelIsDefault: !model,
    source: key ? (fileKeys.has("OPENAI_API_KEY") ? "env-file" : "environment") : null,
  };
}

const PING_TIMEOUT_MS = 4000;

export async function getSupabaseStatus(): Promise<SupabaseStatus> {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  let urlHost: string | null = null;
  try {
    urlHost = url ? new URL(url).host : null;
  } catch {
    urlHost = "invalid URL";
  }
  const configured = isSupabaseConfigured();
  const status: SupabaseStatus = {
    urlHost,
    anonKey: Boolean(clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
    serviceRoleKey: Boolean(clean(process.env.SUPABASE_SERVICE_ROLE_KEY)),
    configured,
    ping: null,
  };
  if (!configured) return status;

  const t0 = performance.now();
  try {
    const { count, error } = await createAdminClient()
      .from("venues")
      .select("id", { count: "exact", head: true })
      .abortSignal(AbortSignal.timeout(PING_TIMEOUT_MS));
    if (error) throw new Error(error.message);
    status.ping = { ok: true, latencyMs: Math.round(performance.now() - t0), venues: count ?? 0 };
  } catch (err) {
    status.ping = { ok: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
  return status;
}

export { canEditEnvFile };
