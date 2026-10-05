import "server-only";

import { openai } from "@ai-sdk/openai";

// Newest OpenAI text model at the time of writing; override per environment
// with OPENAI_MODEL rather than editing code when models change.
const DEFAULT_MODEL = "gpt-6.1-sol";

/** The configured language model, or null when OPENAI_API_KEY isn't set. */
export function getLanguageModel() {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  return openai(process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL);
}

export const AI_NOT_CONFIGURED = "AI features are not configured: set OPENAI_API_KEY for this environment.";
