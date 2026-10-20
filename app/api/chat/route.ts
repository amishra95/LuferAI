import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";

import { instructionsSuffix } from "@/lib/agents/config";
import { takesTemperature } from "@/lib/agents/config";
import { getAgent, recordRun, syncAgentConfigs } from "@/lib/agents/store";
import { clip } from "@/lib/telemetry/runs";
import { AI_UNAVAILABLE, aiCircuitOpen, aiUnavailableResponse, backendNotConfigured, getLanguageModel, isAiUnavailable } from "@/lib/ai/model";
import { allowedTools, financeFirstStep } from "@/lib/ai/chat-policy";
import { WORKSPACE_AGENT_SYSTEM } from "@/lib/ai/prompts";
import { createChatTools } from "@/lib/ai/chat-tools";
import { traceTools } from "@/lib/ai/trace-tools";
import { analyticsScopeFor } from "@/lib/analytics/service";
import { canAccessWorkspace } from "@/lib/auth/roles";
import { getCurrentMember } from "@/lib/auth/session";
import { tracer } from "@/lib/tracer";
import type { LuferUIMessage } from "@/types/chat";

export const maxDuration = 300; // Seconds: Gemini agent runs can take minutes (Vercel Hobby allows up to 300)

const MAX_MESSAGES = 100;

/** Admins analyse the platform; client users only ever their own company. */
/**
 * Workspace chat: a live model (lib/ai/model.ts) streamed token by token to the
 * client via the AI SDK UI message stream.
 *
 * Order of checks: session (401) → workspace role (403) → analytics scope (403)
 * → message validation (400) → agent enabled / model configured (503). Tools
 * are bound to the caller's scope and filtered by role before the model sees
 * them, so neither the prompt nor the model can reach other companies' data.
 *
 * Traced as `api.chat` (until the stream finishes) with `llm.stream`,
 * `llm.http` and `tool.*` children.
 */
async function handleChat(req: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  tracer.annotate({ role: member.role, corporateRole: member.corporateRole });
  // Lets admins open this request's trace from the chat inspector.
  const traceId = member.role === "ADMIN" ? tracer.currentSpan()?.traceId : undefined;
  if (!canAccessWorkspace(member.role, member.corporateRole, "/chat")) return Response.json({ error: "forbidden" }, { status: 403 });

  const scope = await analyticsScopeFor(member);
  if (!scope) return Response.json({ error: "forbidden" }, { status: 403 });
  const chatTools = traceTools(createChatTools(scope));

  const body = await req.json().catch(() => null);
  let messages: LuferUIMessage[];
  try {
    messages = await validateUIMessages<LuferUIMessage>({ messages: body?.messages, tools: chatTools });
  } catch {
    return Response.json({ error: "Invalid chat messages." }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return Response.json({ error: "Conversation is too long. Start a new chat." }, { status: 413 });
  }

  // Settings from the Agents page.
  await syncAgentConfigs();
  const agent = getAgent("workspace-agent")!;
  if (!agent.enabled) {
    return Response.json({ error: "The workspace agent is disabled. Enable it on the Agents page." }, { status: 503 });
  }

  const started = Date.now();
  const record = (ok: boolean, extra: { error?: string; tokens?: number; steps?: number } = {}) =>
    recordRun("workspace-agent", { at: new Date().toISOString(), ok, durationMs: Date.now() - started, source: "chat", task: `Chat: “${clip(lastUserText)}”`, ...extra });

  // Interactive chat: Gemini's fast model (lib/ai/model.ts); agent routes keep the standard one.
  const model = getLanguageModel({ backend: agent.model, usage: { agent: "workspace-agent", source: "chat" }, speed: "fast" });
  if (!model) return Response.json({ error: backendNotConfigured(agent.model) }, { status: 503 });
  // Provider known to be down: answer at once instead of waiting on retries.
  if (aiCircuitOpen()) return aiUnavailableResponse();

  const tools = allowedTools(member.role, agent.tools);
  const lastUserText =
    messages
      .findLast((m) => m.role === "user")
      ?.parts.map((p) => (p.type === "text" ? p.text : ""))
      .join(" ") ?? "";
  // Finance questions: the first step may only call (and must call) a finance tool.
  const financeStep = financeFirstStep(tools, lastUserText);

  const modelMessages = await convertToModelMessages(messages);
  const llm = tracer.startSpan("llm.stream", {
    attributes: { model: model.modelId, messages: messages.length, activeTools: tools, financeFirst: Boolean(financeStep) },
  });
  // Started inside llm.run so the provider requests and tool calls are its children.
  const result = llm.run(() => streamText({
    model,
    system: WORKSPACE_AGENT_SYSTEM + instructionsSuffix(agent.instructions),
    messages: modelMessages,
    tools: chatTools,
    activeTools: tools,
    prepareStep: ({ stepNumber }) => (stepNumber === 0 && financeStep ? financeStep : {}),
    // A forced tool call needs a follow-up step to write the answer.
    stopWhen: isStepCount(financeStep ? Math.max(agent.maxSteps, 2) : agent.maxSteps),
    ...(agent.temperature !== null && takesTemperature(agent.model) && { temperature: agent.temperature }),
    onEnd: ({ totalUsage, steps, finishReason }) => {
      llm.setAttributes({ tokens: totalUsage.totalTokens, steps: steps.length, finishReason });
      llm.end();
      return record(true, { tokens: totalUsage.totalTokens, steps: steps.length });
    },
    onError: ({ error }) => {
      llm.recordError(error);
      llm.end();
    },
  }));

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof chatTools, LuferUIMessage>({
      stream: result.stream,
      tools: chatTools,
      originalMessages: messages,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { model: model.modelId, ...(traceId && { traceId }) };
        if (part.type === "finish") return { usage: part.totalUsage };
      },
      onError: (err) => {
        console.error("chat: stream failed", err);
        void record(false, { error: err instanceof Error ? err.message : "Stream failed" });
        return isAiUnavailable(err) ? AI_UNAVAILABLE : "The model request failed. Try again.";
      },
    }),
  });
}

export const POST = tracer.traceResponse("api.chat", handleChat);
