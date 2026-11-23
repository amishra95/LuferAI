import "server-only";

import { PROVIDERS, type Provider } from "@/lib/ai/routing";

/** Env var holding each provider's key (mirrors lib/ai/model.ts). */
export const PROVIDER_ENV: Record<Provider, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
};

export const PROVIDER_NAME: Record<Provider, string> = { google: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic", groq: "Groq" };

export interface KeyCheck {
  provider: Provider;
  /** "missing": no key set; "ok": the provider accepted it; "rejected": 401/403; "error": anything else. */
  state: "missing" | "ok" | "rejected" | "error";
  detail: string;
}

/**
 * Each provider's "list models" endpoint: free (no tokens), and it fails with 401/403
 * exactly when the key is wrong, revoked or out of credit. Never returns the key.
 */
function request(provider: Provider, key: string): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case "google":
      return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: { "x-goog-api-key": key } };
    case "openai":
      return { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } };
    case "anthropic":
      return { url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
    case "groq":
      return { url: "https://api.groq.com/openai/v1/models", headers: { Authorization: `Bearer ${key}` } };
  }
}

export async function checkProviderKey(provider: Provider, fetcher: typeof fetch = fetch): Promise<KeyCheck> {
  const key = process.env[PROVIDER_ENV[provider]]?.trim();
  if (!key) return { provider, state: "missing", detail: `${PROVIDER_ENV[provider]} isn't set` };
  const { url, headers } = request(provider, key);
  try {
    const res = await fetcher(url, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (res.ok) return { provider, state: "ok", detail: "Key accepted" };
    // Google answers a bad key with 400 API_KEY_INVALID.
    if (res.status === 401 || res.status === 403 || (provider === "google" && res.status === 400)) {
      return { provider, state: "rejected", detail: `Key rejected (${res.status}): replace ${PROVIDER_ENV[provider]}` };
    }
    return { provider, state: "error", detail: `${PROVIDER_NAME[provider]} returned ${res.status}` };
  } catch {
    return { provider, state: "error", detail: `Couldn't reach ${PROVIDER_NAME[provider]}` };
  }
}

export const checkAllProviderKeys = (fetcher?: typeof fetch) => Promise.all(PROVIDERS.map((p) => checkProviderKey(p, fetcher)));
