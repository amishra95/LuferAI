import { google } from "@ai-sdk/google";
import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, safeValidateUIMessages, streamText, toUIMessageStream, type InferUITools, type UIMessage } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createConciergeTools, type ConciergeTools } from "@/lib/agent/tools";
import { traceTools } from "@/lib/ai/trace-tools";
import { getCurrentMember } from "@/lib/auth/session";
import { limitAiRequest } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/site-url";
import { tracer } from "@/lib/tracer";

export type ConciergeUIMessage = UIMessage<unknown, never, InferUITools<ConciergeTools>>;

export const maxDuration = 60; // Seconds; Vercel allows up to 300 on Hobby and 800 on Pro (Fluid compute)

// Override per environment (GEMINI_MODEL) rather than editing code when models change.
const modelId = () => process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

const CONCIERGE_SYSTEM = `You are LuferAI Concierge, the corporate hospitality assistant for LuferAI in Bengaluru.

How you work:
1. Break the request into parts: who is attending, when, how many guests, where, budget per head (INR, pre-GST), and what has to be paid.
2. Query tools for facts instead of guessing:
   - checkTeamAvailability: when the attendees are free on a date.
   - searchVenues: matching venues, estimated cost and (with eventDate) whether bookable venues are free that day.
   - createInvoiceAndPayment: only for an existing booking id or invoice id the user gave you. The user approves it before it runs.
   Call independent tools in the same step. If something essential is missing (e.g. no date), ask one short question.
3. Never invent venues, prices, ratings, availability or payment links. The venue directory has no ratings; say so if asked.
4. End with a short plan, then a "Next actions" list: one line each, starting with a verb (e.g. "Book Toit Indiranagar for 24 Oct, 19:30–22:00").

Today is ${new Date().toISOString().slice(0, 10)} (dates are IST). Amounts are in INR; write them like ₹2,500.`;

const Body = z.object({ messages: z.array(z.unknown()).min(1).max(100) }); // shape-checked by safeValidateUIMessages

/**
 * LuferAI Concierge: Gemini (GEMINI_MODEL, default gemini-2.5-flash) with team-availability, venue and payment
 * tools (lib/agent/tools.ts), up to 5 steps per turn. Payments are proposed as
 * a tool call the user approves in the UI; approvals are HMAC-signed
 * (TOOL_APPROVAL_SECRET) so a modified client can't forge one.
 *
 * Calls Gemini directly rather than through lib/ai/model.ts, so there's no
 * provider failover or usage logging for this route.
 */
async function handleConcierge(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  tracer.annotate({ role: member.role });
  if (member.role !== "CLIENT" && member.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const limited = await limitAiRequest(request, member.userId);
  if (limited) return limited;

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    return NextResponse.json({ error: "The concierge isn't configured: set GOOGLE_GENERATIVE_AI_API_KEY for this environment." }, { status: 503 });
  }
  const approvalSecret = process.env.TOOL_APPROVAL_SECRET;
  if (!approvalSecret) return NextResponse.json({ error: "The concierge needs TOOL_APPROVAL_SECRET configured." }, { status: 503 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const tools = traceTools(createConciergeTools({ member, origin: siteUrl(request.nextUrl.origin) }));
  const validated = await safeValidateUIMessages<ConciergeUIMessage>({ messages: parsed.data.messages, tools });
  if (!validated.success) return NextResponse.json({ error: "invalid_messages" }, { status: 400 });
  const messages = validated.data;

  const modelMessages = await convertToModelMessages(messages, { tools });
  const llm = tracer.startSpan("llm.stream", { attributes: { model: modelId(), messages: messages.length } });
  // Started inside llm.run so the provider requests and tool calls are its children.
  const result = llm.run(() =>
    streamText({
      model: google(modelId()),
      instructions: CONCIERGE_SYSTEM,
      messages: modelMessages,
      tools,
      toolApproval: {
        createInvoiceAndPayment: { type: "user-approval", reason: "Creates a GST invoice and a Razorpay checkout for this booking." },
      },
      experimental_toolApprovalSecret: approvalSecret,
      stopWhen: isStepCount(5),
      onEnd: ({ totalUsage, steps }) => {
        llm.setAttributes({ tokens: totalUsage.totalTokens, steps: steps.length });
        llm.end();
      },
      onError: ({ error }) => {
        llm.recordError(error);
        llm.end();
        console.error("agent/chat: stream failed", error);
      },
    })
  );

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof tools, ConciergeUIMessage>({
      stream: result.stream,
      tools,
      originalMessages: messages,
      onError: () => "The concierge couldn't respond. Try again.",
    }),
  });
}

export const POST = tracer.traceResponse("api.agent.chat", handleConcierge);
