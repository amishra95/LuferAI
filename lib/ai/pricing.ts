/**
 * List prices for the models agents run on, in USD per million tokens, for the
 * spend figures on /agents (agent_execution_logs.cost). Provider list prices,
 * not invoices: cached-input discounts and fallbacks aren't reflected.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/agent-observability.test.mjs).
 */

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "gemini-3.1-flash-lite": { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  "gemini-2.0-flash": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  "gemini-1.5-flash": { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "llama-3.3-70b-versatile": { inputPerMTok: 0.59, outputPerMTok: 0.79 },
};

/** USD for one call, rounded to 6 decimals; null when the model's price isn't listed. */
export function costOf(model: string, promptTokens: number, completionTokens: number): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const usd = (Math.max(0, promptTokens) * price.inputPerMTok + Math.max(0, completionTokens) * price.outputPerMTok) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
