/**
 * Agent config changes: the one validator behind the server action and the
 * client form (which checks before showing the change optimistically), plus
 * applying a patch to a record.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/mutations.test.mjs).
 */

/** Keep in sync with ChatToolName (types/chat.ts); the type check in lib/agents/store.ts enforces it. */
export const AGENT_TOOLS = ["searchVenues", "getPlatformMetrics", "analyzeSpend", "forecastBudget"] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];

/** Configured agents (lib/agents/store.ts). Keep in sync with AgentId (types/agents.ts); store.ts checks it. */
export const AGENT_IDS = ["workspace-agent", "channel-concierge", "venue-sourcer", "metrics-reporter"] as const;
export const isConfiguredAgent = (id: string) => (AGENT_IDS as readonly string[]).includes(id);

/** Agents whose prompt the app builds, so operator instructions apply to them. */
export const PROMPTABLE_AGENTS = ["workspace-agent", "channel-concierge"] as const;
export const MAX_INSTRUCTIONS = 1000;

export interface AgentPatch {
  enabled?: boolean;
  tools?: AgentToolName[];
  /** null = the model's default. */
  temperature?: number | null;
  maxSteps?: number;
  /** Extra system-prompt instructions; "" clears them. */
  instructions?: string;
}

export type PatchResult = { ok: true; patch: AgentPatch } | { ok: false; error: string };

const isTool = (t: unknown): t is AgentToolName => typeof t === "string" && (AGENT_TOOLS as readonly string[]).includes(t);

export const isPromptable = (id: string) => (PROMPTABLE_AGENTS as readonly string[]).includes(id);

/** Validates an untrusted patch. Only the fields present are checked and returned. */
export function validateAgentPatch(agentId: string, input: unknown): PatchResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "Invalid change." };
  const raw = input as Record<string, unknown>;
  const patch: AgentPatch = {};

  if ("enabled" in raw) {
    if (typeof raw.enabled !== "boolean") return { ok: false, error: "Invalid enabled value." };
    patch.enabled = raw.enabled;
  }
  if ("tools" in raw) {
    if (!Array.isArray(raw.tools) || !raw.tools.every(isTool)) return { ok: false, error: "Unknown tool." };
    const tools = AGENT_TOOLS.filter((t) => (raw.tools as string[]).includes(t));
    if (tools.length === 0) return { ok: false, error: "Assign at least one tool." };
    patch.tools = tools;
  }
  if ("temperature" in raw) {
    const t = raw.temperature;
    if (t !== null && !(typeof t === "number" && t >= 0 && t <= 2)) {
      return { ok: false, error: "Temperature must be between 0 and 2, or blank for the model default." };
    }
    patch.temperature = t === null ? null : Math.round(t * 100) / 100;
  }
  if ("maxSteps" in raw) {
    const s = raw.maxSteps;
    if (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > 10) return { ok: false, error: "Max steps must be a whole number from 1 to 10." };
    patch.maxSteps = s;
  }
  if ("instructions" in raw) {
    if (typeof raw.instructions !== "string") return { ok: false, error: "Invalid instructions." };
    const text = raw.instructions.replace(/\r\n/g, "\n").trim();
    if (text.length > MAX_INSTRUCTIONS) return { ok: false, error: `Instructions can be at most ${MAX_INSTRUCTIONS} characters.` };
    if (text && !isPromptable(agentId)) return { ok: false, error: "This agent doesn't take custom instructions." };
    patch.instructions = text;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to change." };
  return { ok: true, patch };
}

/** The config dialog's fields → a patch (validated). Blank temperature means the model default. */
export function agentPatchFromForm(agentId: string, form: { tools: string[]; temperature: string; maxSteps: string; instructions?: string }): PatchResult {
  const t = form.temperature.trim();
  const steps = form.maxSteps.trim();
  return validateAgentPatch(agentId, {
    tools: form.tools,
    temperature: t === "" ? null : Number(t),
    maxSteps: steps === "" ? NaN : Number(steps),
    ...(form.instructions !== undefined && { instructions: form.instructions }),
  });
}

export function applyAgentPatch<T extends Required<AgentPatch>>(record: T, patch: AgentPatch): T {
  const next = { ...record };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (next as Record<string, unknown>)[k] = Array.isArray(v) ? [...v] : v;
  return next;
}

/** System-prompt suffix for an agent's operator instructions ("" when none). */
export function instructionsSuffix(instructions: string | undefined): string {
  const text = instructions?.trim();
  return text ? `\n\nOperator instructions (follow them unless they conflict with the rules above):\n${text}` : "";
}
