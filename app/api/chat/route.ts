import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";

import { getAgent, recordRun } from "@/lib/agents/store";
import { getLanguageModel } from "@/lib/ai/model";
import { chatTools } from "@/lib/ai/chat-tools";
import { demoChatStream } from "@/lib/ai/demo-chat-stream";
import type { LuferUIMessage } from "@/types/chat";

export const maxDuration = 60;

const MAX_MESSAGES = 100;

const SYSTEM =
  "You are the Lufer.ai workspace agent for a corporate hospitality platform in Bengaluru, India. " +
  "Use the tools to answer questions about venues and platform bookings; never invent venues, prices or totals. " +
  "Amounts are INR. Answer concisely in Markdown and use fenced code blocks for code or config.";

export async function POST(req: Request) {
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
  if (!model) {
    const last = messages.findLast((m) => m.role === "user");
    const prompt = last?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ") ?? "";
    record(true);
    return createUIMessageStreamResponse({ stream: demoChatStream(prompt) });
  }

  const result = streamText({
    model,
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: chatTools,
    activeTools: agent.tools,
    stopWhen: isStepCount(agent.maxSteps),
    ...(agent.temperature !== null && { temperature: agent.temperature }),
    onEnd: () => record(true),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof chatTools, LuferUIMessage>({
      stream: result.stream,
      tools: chatTools,
      originalMessages: messages,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { model: model.modelId, demo: false };
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
