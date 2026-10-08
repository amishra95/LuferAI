import "server-only";

import { openai } from "@ai-sdk/openai";

// Default OpenAI text model; override per environment with OPENAI_MODEL
// rather than editing code when models change.
export const DEFAULT_MODEL = "gpt-4o";

/** The configured language model, or null when OPENAI_API_KEY isn't set. */
export function getLanguageModel() {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  return openai(process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL);
}

export const AI_NOT_CONFIGURED = "AI features are not configured: set OPENAI_API_KEY for this environment.";
