import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";

import { getAgent, recordRun } from "@/lib/agents/store";
import { clip } from "@/lib/telemetry/runs";
import { AI_NOT_CONFIGURED, AI_UNAVAILABLE, aiCircuitOpen, aiUnavailableResponse, getLanguageModel, isAiUnavailable } from "@/lib/ai/model";
import { allowedTools, financeFirstStep } from "@/lib/ai/chat-policy";
import { createChatTools } from "@/lib/ai/chat-tools";
import { traceTools } from "@/lib/ai/trace-tools";
import { analyticsScopeFor } from "@/lib/analytics/service";
import { canAccessWorkspace } from "@/lib/auth/roles";
import { getCurrentMember } from "@/lib/auth/session";
import { tracer } from "@/lib/tracer";
import type { LuferUIMessage } from "@/types/chat";

export const maxDuration = 60;

const MAX_MESSAGES = 100;

const SYSTEM =
  "You are the Lufer.ai workspace agent for a corporate hospitality platform in Bengaluru, India. " +
  "Use the tools to answer questions about venues, bookings, spend and budgets; never invent venues, prices or totals. " +
  "For money questions call analyzeSpend or forecastBudget and quote their figures, saying they are pre-GST and naming the period. " +
  "Never state a spend, budget or forecast figure that didn't come from a tool result in this conversation; if the tools can't answer, say so. " +
  "Indian financial years run April to March. " +
  "Amounts are INR. Answer concisely in Markdown and use fenced code blocks for code or config.";

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
  const agent = getAgent("workspace-agent")!;
  if (!agent.enabled) {
    return Response.json({ error: "The workspace agent is disabled. Enable it on the Agents page." }, { status: 503 });
  }

  const started = Date.now();
  const record = (ok: boolean, extra: { error?: string; tokens?: number; steps?: number } = {}) =>
    recordRun("workspace-agent", { at: new Date().toISOString(), ok, durationMs: Date.now() - started, source: "chat", task: `Chat: “${clip(lastUserText)}”`, ...extra });

  const model = getLanguageModel();
  if (!model) return Response.json({ error: AI_NOT_CONFIGURED }, { status: 503 });
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
    system: SYSTEM,
    messages: modelMessages,
    tools: chatTools,
    activeTools: tools,
    prepareStep: ({ stepNumber }) => (stepNumber === 0 && financeStep ? financeStep : {}),
    // A forced tool call needs a follow-up step to write the answer.
    stopWhen: isStepCount(financeStep ? Math.max(agent.maxSteps, 2) : agent.maxSteps),
    ...(agent.temperature !== null && { temperature: agent.temperature }),
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
