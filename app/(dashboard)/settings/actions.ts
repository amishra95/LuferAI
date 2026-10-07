"use server";

import { requireWorkspace } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { DEFAULT_MODEL } from "@/lib/ai/model";
import { canEditEnvFile, updateEnvFile } from "@/lib/settings/env-file";
import { DEFAULT_WORKSPACE_NAME, INSPECTOR_COOKIE, WORKSPACE_COOKIE } from "@/lib/settings/preferences";
import { getSupabaseStatus } from "@/lib/settings/status";

export type FormState = { status: "idle" | "success" | "error"; message?: string };

const OPENAI_KEY = /^sk-[A-Za-z0-9_-]{20,300}$/;
const MODEL_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const NOT_EDITABLE: FormState = {
  status: "error",
  message: "Keys can only be changed from `next dev` on localhost. Set them in your hosting provider's environment instead.",
};

export async function saveOpenAISettings(_prev: FormState, form: FormData): Promise<FormState> {
  await requireWorkspace("/settings");
  if (!(await canEditEnvFile())) return NOT_EDITABLE;

  const key = String(form.get("apiKey") ?? "").trim();
  const model = String(form.get("model") ?? "").trim();
  if (key && !OPENAI_KEY.test(key)) return { status: "error", message: "That doesn't look like an OpenAI API key (sk-…)." };
  if (model && !MODEL_ID.test(model)) return { status: "error", message: "Model IDs use letters, numbers, dots, dashes and colons only." };

  // A blank key field keeps the current key; the model field always applies (blank = default).
  await updateEnvFile({ ...(key && { OPENAI_API_KEY: key }), OPENAI_MODEL: model || null });
  revalidatePath("/", "layout");
  return { status: "success", message: key ? "Key saved to .env.local. Chat now uses the live model." : "Model saved." };
}

export async function removeOpenAIKey(): Promise<FormState> {
  await requireWorkspace("/settings");
  if (!(await canEditEnvFile())) return NOT_EDITABLE;
  await updateEnvFile({ OPENAI_API_KEY: null });
  revalidatePath("/", "layout");
  return { status: "success", message: "Key removed. Chat is unavailable until a key is added." };
}

/** Checks the configured key can see the configured model. Sends the key to OpenAI only. */
export async function testOpenAIConnection(): Promise<FormState> {
  await requireWorkspace("/settings");
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { status: "error", message: "No API key is set." };
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  try {
    const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.ok) return { status: "success", message: `Connected. ${model} is available to this key.` };
    if (res.status === 401) return { status: "error", message: "OpenAI rejected the key (401)." };
    if (res.status === 404) return { status: "error", message: `The key works, but ${model} isn't available to it (404).` };
    return { status: "error", message: `OpenAI returned ${res.status}.` };
  } catch {
    return { status: "error", message: "Couldn't reach api.openai.com." };
  }
}

/** Re-runs the Supabase ping on demand (the page also checks on load). */
export async function testSupabaseConnection(): Promise<FormState> {
  await requireWorkspace("/settings");
  const status = await getSupabaseStatus();
  if (!status.configured) return { status: "error", message: "Not configured: the app is using mock data." };
  if (status.ping?.ok) return { status: "success", message: `Connected in ${status.ping.latencyMs} ms · ${status.ping.venues} venues` };
  return { status: "error", message: status.ping?.error ?? "Connection failed." };
}

export async function savePreferences(_prev: FormState, form: FormData): Promise<FormState> {
  await requireWorkspace("/settings");
  const name = String(form.get("workspaceName") ?? "").trim().replace(/\s+/g, " ");
  if (name.length > 40) return { status: "error", message: "Workspace name must be 40 characters or fewer." };

  const jar = await cookies();
  const opts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
  if (name && name !== DEFAULT_WORKSPACE_NAME) jar.set(WORKSPACE_COOKIE, name, opts);
  else jar.delete(WORKSPACE_COOKIE);
  jar.set(INSPECTOR_COOKIE, form.get("inspectorOpen") === "on" ? "1" : "0", opts);

  revalidatePath("/", "layout");
  return { status: "success", message: "Preferences saved." };
}
