import { google } from "@ai-sdk/google";
import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, safeValidateUIMessages, streamText, toUIMessageStream, type InferUITools, type UIMessage } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { loadConciergeMemory, memoryPromptSection } from "@/lib/agent/memory";
import { createConciergeTools, type ConciergeTools } from "@/lib/agent/tools";
import { traceTools } from "@/lib/ai/trace-tools";
import { getCurrentMember } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { limitAiRequest } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { tracer } from "@/lib/tracer";

/** The model that answered, so the UI can show it. */
export type ConciergeMetadata = { model?: string };

export type ConciergeUIMessage = UIMessage<ConciergeMetadata, never, InferUITools<ConciergeTools>>;

export const maxDuration = 60; // Seconds; Vercel allows up to 300 on Hobby and 800 on Pro (Fluid compute)

// Override per environment (GEMINI_MODEL) rather than editing code when models change.
const modelId = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";

// A function, not a constant: "today" must be the request's day, not the server's start-up day.
const conciergeSystem = () => `You are LuferAI Concierge, the corporate hospitality assistant for LuferAI in Bengaluru.

How you work:
1. Break the request into parts: who is attending, when, how many guests, where, budget per head (INR, pre-GST), and what has to be paid.
2. Query tools for facts instead of guessing:
   - checkGoogleCalendarAvailability: when the attendees are free on a date (needs their calendar emails).
   - searchVenues: matching venues, estimated cost and (with eventDate) whether bookable venues are free that day.
   - queryReservationInventory: a venue's availability over a range of dates, once you have its id.
   - checkSpendPolicy: before proposing a booking, whether company/department policy needs sign-off.
   - requestVenuePartnerBooking: send the request to the venue (the user approves first). Ask for the cost centre if you don't know it.
   - createInvoiceAndPayment: a Razorpay checkout for an existing booking or invoice id. The user approves it before it runs.
   - issueCorporateVirtualCard: a single-use card capped at the approved budget (sandbox: test cards only). The user approves first.
   - sendSlackApprovalRequest: when a booking is waiting for internal approval. Never tell the user a payment went through if a tool returned needsApproval.
   - generateBookingContract, then signBookingContract: the B2B agreement. Summarise deposit, GST, minimum spend and cancellation terms,
     share the link, and only sign when the user has confirmed their full name and that they've read it.
   - sendWhatsAppConfirmation: only when the user asks for a confirmation to be sent. The user approves the message first.
   - Memory: updateUserPreferences when the user states a lasting preference; saveBookingMemory after a booking or feedback
     worth remembering; recallBookingMemories to look up past events beyond those already listed below.
   Call independent tools in the same step. If something essential is missing (e.g. no date), ask one short question.
3. Never invent venues, prices, ratings, availability or payment links. The venue directory has no ratings; say so if asked.
4. End with a short plan, then a "Next actions" list: one line each, starting with a verb (e.g. "Book Toit Indiranagar for 24 Oct, 19:30–22:00").

Today is ${new Date().toISOString().slice(0, 10)} (dates are IST). Amounts are in INR; write them like ₹2,500.`;

/** Whether the step's tool results include a refusal for pending internal approval (lib/agent/enterprise-tools.ts). */
function awaitingApproval(step: { toolResults: readonly ({ toolName: string; output: unknown } | undefined)[] } | undefined): boolean {
  return Boolean(
    step?.toolResults.some((r) => {
      const out = r?.output;
      return r?.toolName !== "sendSlackApprovalRequest" && typeof out === "object" && out !== null && "needsApproval" in out && out.needsApproval === true;
    })
  );
}

const Body = z.object({ messages: z.array(z.unknown()).min(1).max(100) }); // shape-checked by safeValidateUIMessages

/**
 * LuferAI Concierge: Gemini (GEMINI_MODEL, default gemini-3.8-flash) with calendar,
 * venue, inventory, payment, WhatsApp and memory tools (lib/agent/tools.ts), up
 * to 5 steps per turn. Before the model runs, the user's preferences and the
 * past memories closest to their request are added to the system prompt
 * (lib/agent/memory.ts). Payments and WhatsApp sends are proposed as tool calls
 * the user approves in the UI; approvals are HMAC-signed (TOOL_APPROVAL_SECRET)
 * so a modified client can't forge one.
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

  // The user's own session: memory is read and written under RLS.
  const memoryClient = dataSource() === "supabase" ? await createClient() : null;
  const tools = traceTools(createConciergeTools({ member, origin: siteUrl(request.nextUrl.origin), memory: memoryClient }));
  const validated = await safeValidateUIMessages<ConciergeUIMessage>({ messages: parsed.data.messages, tools });
  if (!validated.success) return NextResponse.json({ error: "invalid_messages" }, { status: 400 });
  const messages = validated.data;

  const lastUserText =
    messages
      .findLast((m) => m.role === "user")
      ?.parts.map((p) => (p.type === "text" ? p.text : ""))
      .join(" ") ?? "";
  // Pre-execution memory lookup; returns nothing rather than failing the turn.
  const memory = await tracer.trace("agent.memory", () => loadConciergeMemory(memoryClient, member.userId, lastUserText));

  const model = modelId();
  const modelMessages = await convertToModelMessages(messages, { tools });
  const llm = tracer.startSpan("llm.stream", {
    attributes: { model, messages: messages.length, memoryPreferences: Boolean(memory.preferences), memoriesRecalled: memory.memories.length },
  });
  // Started inside llm.run so the provider requests and tool calls are its children.
  const result = llm.run(() =>
    streamText({
      model: google(model),
      instructions: conciergeSystem() + memoryPromptSection(memory),
      messages: modelMessages,
      tools,
      toolApproval: {
        createInvoiceAndPayment: { type: "user-approval", reason: "Creates a GST invoice and a Razorpay checkout for this booking." },
        sendWhatsAppConfirmation: { type: "user-approval", reason: "Sends this message on WhatsApp." },
        requestVenuePartnerBooking: { type: "user-approval", reason: "Sends this booking request to the venue and holds the date." },
        issueCorporateVirtualCard: { type: "user-approval", reason: "Issues a single-use corporate card for this booking (sandbox: test card)." },
        signBookingContract: {
          type: "user-approval",
          reason: "Approving signs this contract electronically in your name. Read it in full at the contract link first.",
        },
      },
      experimental_toolApprovalSecret: approvalSecret,
      // A payment or card refused for pending approval must be followed by the Slack reminder,
      // not a retry or a claim that it went through.
      prepareStep: ({ steps }) => (awaitingApproval(steps.at(-1)) ? { toolChoice: { type: "tool", toolName: "sendSlackApprovalRequest" } } : {}),
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
      messageMetadata: ({ part }) => (part.type === "start" ? { model } : undefined),
      onError: () => "The concierge couldn't respond. Try again.",
    }),
  });
}

export const POST = tracer.traceResponse("api.agent.chat", handleConcierge);
