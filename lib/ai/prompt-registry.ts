/**
 * The prompt registry's pure parts: which prompts are versioned, what a version
 * may contain, and a line diff for comparing two versions on /agents.
 * Storage and activation live in lib/ai/prompt-store.ts.
 *
 * The prompt only steers the model. Prices, discounts and writes are still
 * bounded by the guardrails in code (lib/guardrails, lib/rfp/guardrails) and by
 * the host's signed approval, whatever a version says.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/prompt-guardrail-management.test.mjs).
 */

export const PROMPT_KEYS = ["property-negotiator"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const PROMPT_LABEL: Record<PromptKey, string> = { "property-negotiator": "Property negotiator" };

export const isPromptKey = (v: string): v is PromptKey => (PROMPT_KEYS as readonly string[]).includes(v);

export type PromptStatus = "draft" | "active" | "archived";

export interface PromptVersion {
  id: string;
  promptKey: PromptKey;
  version: number;
  body: string;
  note: string | null;
  status: PromptStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
}

export const PROMPT_BODY_LIMITS = { min: 40, max: 8000 } as const;
export const PROMPT_NOTE_MAX = 200;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** A version's text and change note, normalised (trailing spaces trimmed per line, CRLF → LF). */
export function validatePromptDraft(input: { body: unknown; note: unknown }): Result<{ body: string; note: string | null }> {
  if (typeof input.body !== "string") return { ok: false, error: "Enter the prompt text." };
  const body = input.body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
  if (body.length < PROMPT_BODY_LIMITS.min) return { ok: false, error: `A prompt needs at least ${PROMPT_BODY_LIMITS.min} characters.` };
  if (body.length > PROMPT_BODY_LIMITS.max) return { ok: false, error: `Keep the prompt under ${PROMPT_BODY_LIMITS.max.toLocaleString("en-IN")} characters (it has ${body.length.toLocaleString("en-IN")}).` };
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > PROMPT_NOTE_MAX) return { ok: false, error: `Keep the change note under ${PROMPT_NOTE_MAX} characters.` };
  return { ok: true, value: { body, note: note || null } };
}

export type DiffLine = { type: "same" | "add" | "del"; text: string; /** 1-based, in the old / new text. */ oldLine?: number; newLine?: number };

/** Most lines compared (per side); beyond this the diff falls back to whole-text replace. */
const DIFF_MAX_LINES = 2000;

/** Line diff (longest common subsequence): what changes from `before` to `after`. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return [...a.map((text, i) => ({ type: "del" as const, text, oldLine: i + 1 })), ...b.map((text, i) => ({ type: "add" as const, text, newLine: i + 1 }))];
  }
  // lcs[i][j]: longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: a[i], oldLine: i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j], newLine: j + 1 });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ type: "del", text: a[i], oldLine: i + 1 });
  for (; j < b.length; j++) out.push({ type: "add", text: b[j], newLine: j + 1 });
  return out;
}

export const diffStats = (diff: DiffLine[]) => ({ added: diff.filter((d) => d.type === "add").length, removed: diff.filter((d) => d.type === "del").length });
