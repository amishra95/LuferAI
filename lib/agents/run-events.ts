/**
 * Live agent runs as Server-Sent Events (GET /api/agents/stream): the AI SDK's
 * stream parts mapped to the steps an operator reads — system prompt, thought,
 * tool call, tool response, final output — plus usage and a closing event.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/agent-observability.test.mjs).
 */

export type RunEvent =
  | { type: "system_prompt"; agent: string; model: string; text: string }
  /** Reasoning the provider returns, or text the model wrote before calling tools. */
  | { type: "thought"; step: number; text: string }
  | { type: "tool_call"; step: number; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool_response"; step: number; toolCallId: string; toolName: string; ok: boolean; output: unknown }
  | { type: "final_output"; step: number; text: string }
  | { type: "usage"; promptTokens: number; completionTokens: number; cost: number | null }
  | { type: "error"; message: string }
  | { type: "done"; steps: number; durationMs: number };

export type RunEventType = RunEvent["type"];
export const RUN_EVENT_TYPES: readonly RunEventType[] = ["system_prompt", "thought", "tool_call", "tool_response", "final_output", "usage", "error", "done"];

/** The subset of AI SDK stream parts the mapper reads (TextStreamPart in `ai`). */
export type StreamPartLike =
  | { type: "start-step" }
  | { type: "reasoning-delta"; text: string }
  | { type: "reasoning-end" }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: unknown }
  | { type: "tool-error"; toolCallId: string; toolName: string; error: unknown }
  | { type: "finish-step"; finishReason: string }
  | { type: "error"; error: unknown }
  | { type: string };

/** Tool payloads are clipped so one event stays small. */
export const MAX_PAYLOAD_CHARS = 4000;

export function clipPayload(value: unknown): unknown {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return String(value);
  }
  if (json === undefined || json.length <= MAX_PAYLOAD_CHARS) return value;
  return { truncated: true, preview: json.slice(0, MAX_PAYLOAD_CHARS) };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "Tool failed");

/**
 * A stateful mapper: feed it stream parts in order, get the events to send.
 * Text a step writes before calling tools is a thought; text in the step that
 * finishes without tool calls is the final output.
 */
export function createRunEventMapper() {
  let step = 0;
  let steps = 0;
  let text = "";
  let reasoning = "";

  const flushReasoning = (out: RunEvent[]) => {
    if (reasoning.trim()) out.push({ type: "thought", step, text: reasoning.trim() });
    reasoning = "";
  };

  return {
    get steps() {
      return steps;
    },
    push(part: StreamPartLike): RunEvent[] {
      const out: RunEvent[] = [];
      switch (part.type) {
        case "start-step":
          step += 1;
          steps = step;
          text = "";
          reasoning = "";
          break;
        case "reasoning-delta":
          reasoning += (part as { text: string }).text;
          break;
        case "reasoning-end":
          flushReasoning(out);
          break;
        case "text-delta":
          text += (part as { text: string }).text;
          break;
        case "tool-call": {
          const p = part as { toolCallId: string; toolName: string; input: unknown };
          flushReasoning(out);
          if (text.trim()) out.push({ type: "thought", step, text: text.trim() });
          text = "";
          out.push({ type: "tool_call", step, toolCallId: p.toolCallId, toolName: p.toolName, input: clipPayload(p.input) });
          break;
        }
        case "tool-result": {
          const p = part as { toolCallId: string; toolName: string; output: unknown };
          out.push({ type: "tool_response", step, toolCallId: p.toolCallId, toolName: p.toolName, ok: true, output: clipPayload(p.output) });
          break;
        }
        case "tool-error": {
          const p = part as { toolCallId: string; toolName: string; error: unknown };
          out.push({ type: "tool_response", step, toolCallId: p.toolCallId, toolName: p.toolName, ok: false, output: errorText(p.error) });
          break;
        }
        case "finish-step": {
          flushReasoning(out);
          if (text.trim()) {
            const calledTools = (part as { finishReason: string }).finishReason === "tool-calls";
            out.push(calledTools ? { type: "thought", step, text: text.trim() } : { type: "final_output", step, text: text.trim() });
          }
          text = "";
          break;
        }
        case "error":
          out.push({ type: "error", message: errorText((part as { error: unknown }).error) });
          break;
      }
      return out;
    },
  };
}

/** One SSE frame: the event name is the step type; data is the JSON event. */
export function encodeRunEvent(event: RunEvent, id: number): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Splits buffered SSE text into complete events (the client reads the stream
 * with fetch, not EventSource, so a dropped connection never re-runs the agent).
 * Returns the parsed events and the unfinished remainder to keep buffering.
 */
export function parseSseFrames(buffer: string): { events: RunEvent[]; rest: string } {
  const frames = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = frames.pop() ?? "";
  const events: RunEvent[] = [];
  for (const frame of frames) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue; // comments (heartbeats) and bare ids
    try {
      const event = JSON.parse(data) as RunEvent;
      if (event && RUN_EVENT_TYPES.includes(event.type)) events.push(event);
    } catch {
      // A malformed frame is skipped, not fatal.
    }
  }
  return { events, rest };
}
