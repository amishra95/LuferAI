import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AI_NOT_CONFIGURED, aiCircuitOpen, aiUnavailableResponse, getLanguageModel, isAiUnavailable } from "@/lib/ai/model";
import { rfpExtractionInstructions } from "@/lib/ai/prompts";
import { getCurrentMember } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { todayInIndia } from "@/lib/gst-engine";
import { broadcastRfp, PolicyBlockedError, RfpRequirements, type BroadcastResult } from "@/lib/rfp/service";
import { clip, logAgentRun } from "@/lib/telemetry/runs";
import { tracer } from "@/lib/tracer";

/**
 * POST { brief, companyId? } → structured RFP broadcast to matching venues.
 *
 * 1. The model turns the free-text brief into RfpRequirements (structured output).
 * 2. Venues are matched and priced deterministically (lib/quotes): menu package,
 *    min spend, the company's rate card and GST — no model-invented numbers.
 * 3. Returns the side-by-side Markdown comparison matrix; venues can later counter
 *    from /property and the matrix on /client updates.
 *
 * Rate-limited by middleware.ts (/api/ai/*).
 */
export const maxDuration = 300; // Seconds: Gemini agent runs can take minutes (Vercel Hobby allows up to 300)

const Body = z.object({
  brief: z.string().trim().min(20, "Describe the event in a sentence or two").max(4000),
  companyId: z.uuid().optional(), // admins only
});

async function handleRfpBroadcast(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  tracer.annotate({ role: member.role });
  if (member.role !== "CLIENT" && member.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const model = getLanguageModel({ usage: { agent: "rfp-broadcaster", source: "api" } });
  if (!model) return NextResponse.json({ error: AI_NOT_CONFIGURED }, { status: 503 });
  if (aiCircuitOpen()) return aiUnavailableResponse();
  if (dataSource() !== "supabase") {
    return NextResponse.json({ error: "RFP broadcast needs the live database." }, { status: 503 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_request" }, { status: 400 });
  }
  const companyId = member.role === "ADMIN" ? parsed.data.companyId : member.companyId;
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 });

  const today = todayInIndia();
  const started = Date.now();
  const task = `RFP from brief: “${clip(parsed.data.brief)}”`;
  let requirements: RfpRequirements;
  try {
    const { output, totalUsage } = await tracer.trace("llm.generate", async (span) => {
      const r = await generateText({
        model,
        output: Output.object({ schema: RfpRequirements }),
        instructions: rfpExtractionInstructions(today),
        prompt: parsed.data.brief,
      });
      span.setAttributes({ model: model.modelId, tokens: r.totalUsage.totalTokens });
      return r;
    });
    requirements = output;
    await logAgentRun("rfp-broadcaster", { at: new Date().toISOString(), ok: true, durationMs: Date.now() - started, source: "api", task, tokens: totalUsage.totalTokens, steps: 1 });
  } catch (err) {
    await logAgentRun("rfp-broadcaster", { at: new Date().toISOString(), ok: false, durationMs: Date.now() - started, source: "api", task, error: err instanceof Error ? err.message : "Extraction failed" });
    // No output, or output that isn't JSON / doesn't fit RfpRequirements: the brief is the problem, not the service.
    if (NoOutputGeneratedError.isInstance(err) || NoObjectGeneratedError.isInstance(err)) {
      return NextResponse.json({ error: "Couldn't read that brief — add the guest count and date." }, { status: 422 });
    }
    console.error("rfp-broadcast extraction failed", err);
    if (isAiUnavailable(err)) return aiUnavailableResponse();
    return NextResponse.json({ error: "The AI service is unavailable. Try again shortly." }, { status: 502 });
  }

  let result: BroadcastResult;
  try {
    result = await tracer.trace("rfp.broadcast", async (span) => {
      const r = await broadcastRfp({
        companyId,
        createdBy: member.userId,
        brief: parsed.data.brief,
        requirements,
        today,
      });
      span.setAttribute("venuesContacted", r.columns.length);
      return r;
    });
  } catch (err) {
    // Out of policy: nothing was sent; say why, with the breakdown.
    if (err instanceof PolicyBlockedError) return NextResponse.json({ error: err.message, policy: err.policy }, { status: 422 });
    throw err;
  }

  return NextResponse.json({
    rfpId: result.rfp.id,
    requirements,
    venuesContacted: result.columns.length,
    matrix: result.markdown,
    policy: result.policy,
  });
}

export const POST = tracer.traceResponse("api.ai.rfp-broadcast", handleRfpBroadcast);
