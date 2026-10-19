import "server-only";

import { DEFAULT_PLATFORM_GUARDRAILS, parsePlatformGuardrails, type PlatformGuardrails } from "@/lib/guardrails/platform";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * platform_guardrail_settings (migration 0028): the ceilings admins tune on
 * /agents. Read on every RFP broadcast, counter and negotiator tool call, so
 * it's cached per instance for CACHE_TTL_MS; a save applies at once on the
 * instance that made it and within that window elsewhere. Before the
 * migration, without Supabase, or if a read fails, the defaults (the limits
 * that were constants before) apply.
 */

const CACHE_TTL_MS = 15_000;
const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export const PLATFORM_GUARDRAILS_UNAVAILABLE = "Guardrail tuning needs database migration 0028 (platform_guardrail_settings). Ask an admin to apply it.";

export class PlatformGuardrailsError extends Error {}

export interface PlatformGuardrailsState {
  settings: PlatformGuardrails;
  /** The table exists (settings can be saved). */
  ready: boolean;
  updatedAt: string | null;
}

type Cache = { at: number; value: PlatformGuardrailsState };
const g = globalThis as typeof globalThis & { __luferPlatformGuardrails?: Cache | null; __luferPlatformGuardrailsWarned?: boolean };

/** The settings in force. Never throws. */
export async function getPlatformGuardrails(): Promise<PlatformGuardrailsState> {
  const hit = g.__luferPlatformGuardrails;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  let value: PlatformGuardrailsState = { settings: DEFAULT_PLATFORM_GUARDRAILS, ready: false, updatedAt: null };
  if (isSupabaseConfigured()) {
    const { data, error } = await createAdminClient().from("platform_guardrail_settings").select("settings, updated_at").eq("id", true).maybeSingle();
    if (error && !isMissingTable(error)) {
      if (!g.__luferPlatformGuardrailsWarned) console.error("guardrails: could not read platform settings; using the last known or default limits", error);
      g.__luferPlatformGuardrailsWarned = true;
      if (hit) return hit.value;
    } else if (!error) {
      value = { settings: data ? parsePlatformGuardrails(data.settings) : DEFAULT_PLATFORM_GUARDRAILS, ready: true, updatedAt: data?.updated_at ?? null };
    }
  }
  g.__luferPlatformGuardrails = { at: Date.now(), value };
  return value;
}

export async function savePlatformGuardrails(settings: PlatformGuardrails, updatedBy: string | null): Promise<PlatformGuardrailsState> {
  if (!isSupabaseConfigured()) throw new PlatformGuardrailsError("Guardrail tuning needs the Supabase database.");
  const { data, error } = await createAdminClient()
    .from("platform_guardrail_settings")
    .upsert({ id: true, settings: settings as unknown as Json, updated_by: updatedBy }, { onConflict: "id" })
    .select("settings, updated_at")
    .single();
  if (isMissingTable(error)) throw new PlatformGuardrailsError(PLATFORM_GUARDRAILS_UNAVAILABLE);
  if (error) throw new Error(error.message);
  const value = { settings: parsePlatformGuardrails(data.settings), ready: true, updatedAt: data.updated_at };
  g.__luferPlatformGuardrails = { at: Date.now(), value };
  return value;
}
