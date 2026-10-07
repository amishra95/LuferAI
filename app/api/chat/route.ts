import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";

import { getAgent, recordRun } from "@/lib/agents/store";
import { AI_NOT_CONFIGURED, getLanguageModel } from "@/lib/ai/model";
import { allowedTools, financeFirstStep } from "@/lib/ai/chat-policy";
import { createChatTools } from "@/lib/ai/chat-tools";
import type { AnalyticsScope } from "@/lib/analytics/service";
import { canAccessWorkspace } from "@/lib/auth/roles";
import { getCurrentMember, type Member } from "@/lib/auth/session";
import { listCompanies } from "@/lib/data";
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
async function scopeFor(member: Member): Promise<AnalyticsScope | null> {
  if (member.role === "ADMIN") return { kind: "platform" };
  if (member.role !== "CLIENT" || !member.companyId) return null;
  const company = (await listCompanies()).find((c) => c.id === member.companyId);
  return company ? { kind: "company", companyId: company.id, companyName: company.legal_name.replace(" Private Limited", "") } : null;
}

/**
 * Workspace chat: a live model (lib/ai/model.ts) streamed token by token to the
 * client via the AI SDK UI message stream.
 *
 * Order of checks: session (401) → workspace role (403) → analytics scope (403)
 * → message validation (400) → agent enabled / model configured (503). Tools
 * are bound to the caller's scope and filtered by role before the model sees
 * them, so neither the prompt nor the model can reach other companies' data.
 */
export async function POST(req: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canAccessWorkspace(member.role, member.corporateRole, "/chat")) return Response.json({ error: "forbidden" }, { status: 403 });

  const scope = await scopeFor(member);
  if (!scope) return Response.json({ error: "forbidden" }, { status: 403 });
  const chatTools = createChatTools(scope);

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
  const record = (ok: boolean, error?: string) =>
    recordRun("workspace-agent", { at: new Date().toISOString(), ok, durationMs: Date.now() - started, source: "chat", error });

  const model = getLanguageModel();
  if (!model) return Response.json({ error: AI_NOT_CONFIGURED }, { status: 503 });

  const tools = allowedTools(member.role, agent.tools);
  const lastUserText =
    messages
      .findLast((m) => m.role === "user")
      ?.parts.map((p) => (p.type === "text" ? p.text : ""))
      .join(" ") ?? "";
  // Finance questions: the first step may only call (and must call) a finance tool.
  const financeStep = financeFirstStep(tools, lastUserText);

  const result = streamText({
    model,
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: chatTools,
    activeTools: tools,
    prepareStep: ({ stepNumber }) => (stepNumber === 0 && financeStep ? financeStep : {}),
    // A forced tool call needs a follow-up step to write the answer.
    stopWhen: isStepCount(financeStep ? Math.max(agent.maxSteps, 2) : agent.maxSteps),
    ...(agent.temperature !== null && { temperature: agent.temperature }),
    onEnd: () => record(true),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof chatTools, LuferUIMessage>({
      stream: result.stream,
      tools: chatTools,
      originalMessages: messages,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { model: model.modelId };
        if (part.type === "finish") return { usage: part.totalUsage };
      },
      onError: (err) => {
        console.error("chat: stream failed", err);
        record(false, err instanceof Error ? err.message : "Stream failed");
        return "The model request failed. Try again.";
      },
    }),
  });
}
