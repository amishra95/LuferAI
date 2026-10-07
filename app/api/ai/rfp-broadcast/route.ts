import { generateText, NoOutputGeneratedError, Output } from "ai";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AI_NOT_CONFIGURED, getLanguageModel } from "@/lib/ai/model";
import { getCurrentMember } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { todayInIndia } from "@/lib/gst-engine";
import { broadcastRfp, RfpRequirements } from "@/lib/rfp/service";

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
export const maxDuration = 60;

const Body = z.object({
  brief: z.string().trim().min(20, "Describe the event in a sentence or two").max(4000),
  companyId: z.uuid().optional(), // admins only
});

export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (member.role !== "CLIENT" && member.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const model = getLanguageModel();
  if (!model) return NextResponse.json({ error: AI_NOT_CONFIGURED }, { status: 503 });
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
  let requirements: RfpRequirements;
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: RfpRequirements }),
      instructions: [
        "You turn a corporate event brief into a structured RFP for hospitality venues in India.",
        `Today is ${today} (Asia/Kolkata). Resolve relative dates ("next Friday") to YYYY-MM-DD.`,
        "Only extract what the brief states or clearly implies; use null / empty lists otherwise.",
        "Budgets are pre-GST INR per guest; convert totals to per-head when the guest count is known.",
        "dietary lists needs the whole menu must satisfy (e.g. an all-vegetarian team → vegetarian).",
      ].join("\n"),
      prompt: parsed.data.brief,
    });
    requirements = output;
  } catch (err) {
    if (NoOutputGeneratedError.isInstance(err)) {
      return NextResponse.json({ error: "Couldn't read that brief — add the guest count and date." }, { status: 422 });
    }
    console.error("rfp-broadcast extraction failed", err);
    return NextResponse.json({ error: "The AI service is unavailable. Try again shortly." }, { status: 502 });
  }

  const result = await broadcastRfp({
    companyId,
    createdBy: member.userId,
    brief: parsed.data.brief,
    requirements,
    today,
  });

  return NextResponse.json({
    rfpId: result.rfp.id,
    requirements,
    venuesContacted: result.columns.length,
    matrix: result.markdown,
  });
}
