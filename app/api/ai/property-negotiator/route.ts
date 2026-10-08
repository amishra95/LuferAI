import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AI_NOT_CONFIGURED, AI_UNAVAILABLE, aiCircuitOpen, aiUnavailableResponse, getLanguageModel, isAiUnavailable } from "@/lib/ai/model";
import { getCurrentMember } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { traceTools } from "@/lib/ai/trace-tools";
import { negotiatorTools, type NegotiatorUIMessage } from "@/lib/negotiator";
import { createClient } from "@/lib/supabase/server";
import { logAgentRun } from "@/lib/telemetry/runs";
import { tracer } from "@/lib/tracer";

/**
 * Streaming chat for venue hosts to tune minimum spend and dietary menu packages.
 * Reads run freely; every write is proposed as a tool call the host must approve
 * in the panel. Approvals are HMAC-signed (TOOL_APPROVAL_SECRET) so a modified
 * client can't forge one. Rate-limited by middleware.ts (/api/ai/*).
 */
export const maxDuration = 60;

const Body = z.object({
  messages: z.array(z.unknown()).min(1).max(100), // shape-checked by safeValidateUIMessages
  venueId: z.uuid().optional(), // admins only
});

async function handleNegotiator(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  tracer.annotate({ role: member.role });
  if (member.role !== "PROPERTY" && member.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const model = getLanguageModel();
  if (!model) return NextResponse.json({ error: AI_NOT_CONFIGURED }, { status: 503 });
  if (aiCircuitOpen()) return aiUnavailableResponse();
  const approvalSecret = process.env.TOOL_APPROVAL_SECRET;
  if (dataSource() !== "supabase" || !approvalSecret) {
    return NextResponse.json(
      { error: "The negotiator needs the live database and TOOL_APPROVAL_SECRET configured." },
      { status: 503 }
    );
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const venueId = member.role === "ADMIN" ? parsed.data.venueId : member.venueId;
  if (!venueId) return NextResponse.json({ error: "venueId is required" }, { status: 400 });

  const tools = traceTools(negotiatorTools(await createClient(), venueId));
  const validated = await safeValidateUIMessages<NegotiatorUIMessage>({ messages: parsed.data.messages, tools });
  if (!validated.success) return NextResponse.json({ error: "invalid_messages" }, { status: 400 });
  const messages = validated.data;

  const started = Date.now();
  const task = `Pricing session for venue ${venueId.slice(0, 8)}`;
  const modelMessages = await convertToModelMessages(messages, { tools });
  const llm = tracer.startSpan("llm.stream", { attributes: { model: model.modelId, messages: messages.length } });
  const result = llm.run(() => streamText({
    model,
    instructions: [
      "You are a revenue assistant for a hospitality venue on a corporate events marketplace in India.",
      "Help the host set minimum spend and design menu packages that win corporate RFPs without underpricing.",
      "Always call getVenueTerms before proposing a change, and ground advice in its data (open RFP budgets, dietary asks, party sizes).",
      "Amounts are pre-GST INR. GST (18%) and the client's rate-card discount are applied automatically — never add them yourself.",
      "Propose one change per tool call with a concise reason. If the host declines a change, do not retry it; ask what they'd prefer.",
      "Be brief: a short recommendation, then the tool call.",
    ].join("\n"),
    messages: modelMessages,
    tools,
    toolApproval: {
      setMinimumSpend: { type: "user-approval", reason: "Changes the minimum spend on every new quote" },
      upsertMenuPackage: { type: "user-approval", reason: "Changes the menu packages clients are quoted" },
    },
    experimental_toolApprovalSecret: approvalSecret,
    stopWhen: isStepCount(5),
    onError({ error }) {
      llm.recordError(error);
      llm.end();
      console.error("property-negotiator: stream failed", error);
      void logAgentRun("property-negotiator", { at: new Date().toISOString(), ok: false, durationMs: Date.now() - started, source: "api", task, error: error instanceof Error ? error.message : "Stream failed" });
    },
    onEnd: ({ totalUsage, steps }) => {
      llm.setAttributes({ tokens: totalUsage.totalTokens, steps: steps.length });
      llm.end();
      return logAgentRun("property-negotiator", { at: new Date().toISOString(), ok: true, durationMs: Date.now() - started, source: "api", task, tokens: totalUsage.totalTokens, steps: steps.length });
    },
  }));

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (err) => (isAiUnavailable(err) ? AI_UNAVAILABLE : "The negotiator couldn't respond. Try again."),
    }),
  });
}

export const POST = tracer.traceResponse("api.ai.property-negotiator", handleNegotiator);
