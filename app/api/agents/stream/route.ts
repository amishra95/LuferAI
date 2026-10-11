import { isStepCount, streamText } from "ai";
import type { NextRequest } from "next/server";

import { instructionsSuffix, isConfiguredAgent, takesTemperature } from "@/lib/agents/config";
import { createRunEventMapper, encodeRunEvent, type RunEvent } from "@/lib/agents/run-events";
import { getAgent, recordRun, syncAgentConfigs } from "@/lib/agents/store";
import { authorize } from "@/lib/api/respond";
import { allowedTools } from "@/lib/ai/chat-policy";
import { createChatTools } from "@/lib/ai/chat-tools";
import { aiCircuitOpen, aiUnavailableResponse, AI_UNAVAILABLE, backendNotConfigured, getLanguageModel, isAiUnavailable } from "@/lib/ai/model";
import { costOf } from "@/lib/ai/pricing";
import { WORKSPACE_AGENT_SYSTEM } from "@/lib/ai/prompts";
import { traceTools } from "@/lib/ai/trace-tools";
import { analyticsScopeFor } from "@/lib/analytics/service";
import { canAccessWorkspace } from "@/lib/auth/roles";
import { clip } from "@/lib/telemetry/runs";
import { tracer } from "@/lib/tracer";
import type { AgentId, AgentRecord } from "@/types/agents";

/**
 * GET /api/agents/stream?agent=<id>&prompt=<text> — runs one agent turn and
 * streams it as Server-Sent Events, one event per step (lib/agents/run-events.ts):
 *
 *   system_prompt → thought* → (tool_call → tool_response)* → final_output → usage → done
 *
 * For operators on /agents (admins): the run uses the agent's saved settings
 * (model backend, tools, temperature, max steps, instructions) with platform
 * scope. Tokens are logged by the usage middleware like any other call, and the
 * run is recorded as a test run. The stream ends after `done` or `error`;
 * clients must close their EventSource then, or it would reconnect and run the
 * agent again.
 */

export const maxDuration = 60;

const MAX_PROMPT = 2000;
const HEARTBEAT_MS = 15_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** The workspace agent's own prompt; other agents get their role from the description. */
function systemPromptFor(agent: AgentRecord): string {
  const base =
    agent.id === "workspace-agent"
      ? WORKSPACE_AGENT_SYSTEM
      : `You are the Lufer.ai ${agent.name.toLowerCase()} for a corporate hospitality platform in Bengaluru, India: ${agent.description} ` +
        "Use the tools to answer; never invent venues, prices or totals. Amounts are INR. Answer concisely in Markdown.";
  return base + instructionsSuffix(agent.instructions);
}

async function handleStream(request: NextRequest) {
  const auth = await authorize((m) => canAccessWorkspace(m.role, m.corporateRole, "/agents"));
  if ("response" in auth) return auth.response;
  const { member } = auth;

  const id = request.nextUrl.searchParams.get("agent") ?? "";
  const prompt = (request.nextUrl.searchParams.get("prompt") ?? "").trim();
  if (!isConfiguredAgent(id)) return Response.json({ error: "Unknown agent." }, { status: 400 });
  if (!prompt || prompt.length > MAX_PROMPT) return Response.json({ error: `Prompt must be 1–${MAX_PROMPT} characters.` }, { status: 400 });

  await syncAgentConfigs();
  const agent = getAgent(id as AgentId)!;
  if (!agent.enabled) return Response.json({ error: `${agent.name} is disabled. Enable it to run it.` }, { status: 409 });

  const scope = await analyticsScopeFor(member);
  if (!scope) return Response.json({ error: "forbidden" }, { status: 403 });

  const model = getLanguageModel({ backend: agent.model, usage: { agent: agent.id, source: "stream" } });
  if (!model) return Response.json({ error: backendNotConfigured(agent.model) }, { status: 503 });
  if (aiCircuitOpen()) return aiUnavailableResponse();

  const system = systemPromptFor(agent);
  const tools = traceTools(createChatTools(scope));
  const started = Date.now();
  const result = streamText({
    model,
    system,
    prompt,
    tools,
    activeTools: allowedTools(member.role, agent.tools),
    stopWhen: isStepCount(agent.maxSteps),
    ...(agent.temperature !== null && takesTemperature(agent.model) && { temperature: agent.temperature }),
    abortSignal: request.signal,
  });

  const encoder = new TextEncoder();
  let seq = 0;
  let stop = () => {};

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: RunEvent) => !closed && controller.enqueue(encoder.encode(encodeRunEvent(event, ++seq)));
      const heartbeat = setInterval(() => !closed && controller.enqueue(encoder.encode(": keep-alive\n\n")), HEARTBEAT_MS);
      stop = () => {
        closed = true;
        clearInterval(heartbeat);
      };

      const mapper = createRunEventMapper();
      let failure: string | null = null;
      send({ type: "system_prompt", agent: agent.id, model: model.modelId, text: system });
      try {
        for await (const part of result.stream) {
          for (const event of mapper.push(part)) {
            if (event.type === "error") failure ??= event.message;
            send(event);
          }
        }
        if (failure) throw new Error(failure);
        const usage = await result.totalUsage;
        const promptTokens = usage.inputTokens ?? 0;
        const completionTokens = usage.outputTokens ?? 0;
        send({ type: "usage", promptTokens, completionTokens, cost: costOf(model.modelId, promptTokens, completionTokens) });
      } catch (err) {
        // A stream error was already sent as its own event.
        if (!request.signal.aborted && failure === null) {
          console.error("agents/stream: run failed", err);
          failure = isAiUnavailable(err) ? AI_UNAVAILABLE : "The model request failed. Try again.";
          send({ type: "error", message: failure });
        }
      }

      const durationMs = Date.now() - started;
      send({ type: "done", steps: mapper.steps, durationMs });
      void recordRun(agent.id, {
        at: new Date().toISOString(),
        ok: failure === null && !request.signal.aborted,
        durationMs,
        source: "test",
        task: `Live run: “${clip(prompt)}”`,
        steps: mapper.steps,
        ...(failure && { error: failure }),
      });
      stop();
      try {
        controller.close();
      } catch {
        // The client already went away.
      }
    },
    cancel() {
      stop();
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
}

export const GET = tracer.traceResponse("api.agents.stream", handleStream);
