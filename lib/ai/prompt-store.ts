import "server-only";

import { NEGOTIATOR_INSTRUCTIONS } from "@/lib/ai/prompts";
import { type PromptKey, type PromptVersion } from "@/lib/ai/prompt-registry";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";

/**
 * Versioned prompts (agent_prompt_versions, migration 0028). The negotiator
 * reads the active version through activePrompt(), cached per instance for
 * CACHE_TTL_MS, so an activation reaches every instance within that window
 * (immediately on the instance that made it). With no active version, before
 * the migration, or if the read fails, the built-in prompt in lib/ai/prompts.ts
 * is used: a registry problem never takes the agent down.
 */

const BUILT_IN: Record<PromptKey, string> = { "property-negotiator": NEGOTIATOR_INSTRUCTIONS };

export const builtInPrompt = (key: PromptKey) => BUILT_IN[key];

const CACHE_TTL_MS = 15_000;
const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export const REGISTRY_UNAVAILABLE = "The prompt registry needs database migration 0028 (agent_prompt_versions). Ask an admin to apply it.";

/** A refusal whose message is for the admin. */
export class PromptRegistryError extends Error {}

type Row = {
  id: string;
  prompt_key: string;
  version: number;
  body: string;
  note: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
};

const fromRow = (r: Row): PromptVersion => ({
  id: r.id,
  promptKey: r.prompt_key as PromptKey,
  version: r.version,
  body: r.body,
  note: r.note,
  status: r.status as PromptVersion["status"],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  activatedAt: r.activated_at,
});

export interface ActivePrompt {
  text: string;
  /** null = the built-in prompt. */
  version: number | null;
  id: string | null;
}

type Cache = Map<PromptKey, { at: number; value: ActivePrompt }>;
const g = globalThis as typeof globalThis & { __luferPromptCache?: Cache; __luferPromptWarned?: boolean };
const cache: Cache = (g.__luferPromptCache ??= new Map());

/** The prompt the agent should run with now. Never throws. */
export async function activePrompt(key: PromptKey): Promise<ActivePrompt> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const builtIn: ActivePrompt = { text: BUILT_IN[key], version: null, id: null };
  let value = builtIn;
  if (isSupabaseConfigured()) {
    const { data, error } = await createAdminClient().from("agent_prompt_versions").select("id, version, body").eq("prompt_key", key).eq("status", "active").maybeSingle();
    if (error && !isMissingTable(error)) {
      if (!g.__luferPromptWarned) console.error("prompts: could not read the active version; using the built-in prompt", error);
      g.__luferPromptWarned = true;
      // Keep serving the last good version rather than flapping to the built-in.
      if (hit) return hit.value;
    } else if (data) {
      value = { text: data.body, version: data.version, id: data.id };
    }
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

const forget = (key: PromptKey) => cache.delete(key);

/** All versions of a prompt, newest first, and whether the registry can be written here. */
export async function listPromptVersions(key: PromptKey): Promise<{ versions: PromptVersion[]; ready: boolean }> {
  if (!isSupabaseConfigured()) return { versions: [], ready: false };
  const { data, error } = await createAdminClient().from("agent_prompt_versions").select("*").eq("prompt_key", key).order("version", { ascending: false });
  if (isMissingTable(error)) return { versions: [], ready: false };
  if (error) throw error;
  return { versions: data.map(fromRow), ready: true };
}

function failOn(error: { code?: string; message: string } | null) {
  if (isMissingTable(error)) throw new PromptRegistryError(REGISTRY_UNAVAILABLE);
  if (error) throw new Error(error.message);
}

/** A new draft numbered after the latest version. */
export async function createPromptDraft(key: PromptKey, draft: { body: string; note: string | null }, userId: string | null): Promise<PromptVersion> {
  if (!isSupabaseConfigured()) throw new PromptRegistryError("The prompt registry needs the Supabase database.");
  const db = createAdminClient();
  // Two admins drafting at once collide on (prompt_key, version): retry with the next number.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: latest, error: readError } = await db.from("agent_prompt_versions").select("version").eq("prompt_key", key).order("version", { ascending: false }).limit(1).maybeSingle();
    failOn(readError);
    const { data, error } = await db
      .from("agent_prompt_versions")
      .insert({ prompt_key: key, version: (latest?.version ?? 0) + 1, body: draft.body, note: draft.note, status: "draft", created_by: userId })
      .select("*")
      .single();
    if (error?.code === "23505") continue;
    failOn(error);
    return fromRow(data!);
  }
  throw new PromptRegistryError("Someone else is drafting this prompt right now. Try again.");
}

/** Edits a draft. Active and archived versions are a record of what ran, so they can't change. */
export async function updatePromptDraft(id: string, draft: { body: string; note: string | null }): Promise<PromptVersion> {
  const { data, error } = await createAdminClient().from("agent_prompt_versions").update({ body: draft.body, note: draft.note }).eq("id", id).eq("status", "draft").select("*").maybeSingle();
  failOn(error);
  if (!data) throw new PromptRegistryError("Only drafts can be edited. Start a new draft from this version instead.");
  return fromRow(data);
}

export async function deletePromptDraft(id: string): Promise<void> {
  const { data, error } = await createAdminClient().from("agent_prompt_versions").delete().eq("id", id).eq("status", "draft").select("id");
  failOn(error);
  if (!data?.length) throw new PromptRegistryError("Only drafts can be deleted.");
}

/** Makes a version (a draft, or an archived one to roll back) the active one. */
export async function activatePromptVersion(id: string, userId: string | null): Promise<PromptVersion> {
  // p_user may be null (the function stores it as activated_by); the generator types it as string.
  const { data, error } = await createAdminClient().rpc("activate_prompt_version", { p_id: id, p_user: userId as string });
  if (error?.code === "P0002") throw new PromptRegistryError("That version no longer exists.");
  if (error?.code === "PGRST202" || error?.code === "42883") throw new PromptRegistryError(REGISTRY_UNAVAILABLE);
  failOn(error);
  const version = fromRow(data as unknown as Row);
  forget(version.promptKey);
  return version;
}

/** Archives the active version: the agent goes back to the built-in prompt. */
export async function revertToBuiltIn(key: PromptKey): Promise<void> {
  const { error } = await createAdminClient().from("agent_prompt_versions").update({ status: "archived" }).eq("prompt_key", key).eq("status", "active");
  failOn(error);
  forget(key);
}
