import { generateText, Output } from "ai";
import { z } from "zod";

import { AI_NOT_CONFIGURED, aiCircuitOpen, aiUnavailableResponse, getLanguageModel, isAiUnavailable } from "@/lib/ai/model";
import { matchVenues, venueSearchSchema } from "@/lib/ai/venue-sourcing";
import { getCurrentMember } from "@/lib/auth/session";
import { getCorporatePolicy, listCompanies, listVenues } from "@/lib/data";
import { clip, logAgentRun } from "@/lib/telemetry/runs";
import { tracer } from "@/lib/tracer";

export const maxDuration = 30;

const requestSchema = z.object({
  prompt: z.string().trim().min(3).max(500),
  companyId: z.string().uuid(),
});

/**
 * Natural-language venue search: the model only extracts filters; matching and
 * policy labelling are deterministic (lib/ai/venue-sourcing.ts), so results
 * never include venues or prices the catalogue doesn't have.
 */
async function handleSourceVenues(req: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  tracer.annotate({ role: member.role });
  if (member.role !== "CLIENT" && member.role !== "ADMIN") return Response.json({ error: "forbidden" }, { status: 403 });

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Describe the event in 3–500 characters." }, { status: 400 });
  }
  const { prompt } = parsed.data;
  // Clients search under their own company's policy; only admins may pick one.
  const companyId = member.role === "ADMIN" ? parsed.data.companyId : member.companyId;
  if (!companyId) return Response.json({ error: "Unknown company account." }, { status: 404 });

  const model = getLanguageModel();
  if (!model) return Response.json({ error: AI_NOT_CONFIGURED }, { status: 503 });
  if (aiCircuitOpen()) return aiUnavailableResponse();

  const companies = await listCompanies();
  if (!companies.some((c) => c.id === companyId)) {
    return Response.json({ error: "Unknown company account." }, { status: 404 });
  }

  const started = Date.now();
  const task = `Venue search: “${clip(prompt)}”`;
  let filters;
  try {
    const result = await tracer.trace("llm.generate", async (span) => {
      const r = await generateText({
        model,
        output: Output.object({ schema: venueSearchSchema }),
        system:
          "You turn corporate event requests for venues in Bengaluru, India into search filters. " +
          "Amounts are INR. Convert totals to a per-head budget when the guest count is known. " +
          "Never invent values the request does not imply.",
        prompt,
      });
      span.setAttributes({ model: model.modelId, tokens: r.totalUsage.totalTokens });
      return r;
    });
    filters = result.output;
    await logAgentRun("venue-sourcer", { at: new Date().toISOString(), ok: true, durationMs: Date.now() - started, source: "api", task, tokens: result.totalUsage.totalTokens, steps: 1 });
  } catch (err) {
    console.error("source-venues: model call failed", err);
    await logAgentRun("venue-sourcer", { at: new Date().toISOString(), ok: false, durationMs: Date.now() - started, source: "api", task, error: err instanceof Error ? err.message : "Model call failed" });
    if (isAiUnavailable(err)) return aiUnavailableResponse();
    return Response.json({ error: "Couldn't interpret that request. Try rephrasing it." }, { status: 502 });
  }

  const [venues, policy] = await tracer.trace("db.venuesAndPolicy", () => Promise.all([listVenues(), getCorporatePolicy(companyId)]));
  const options = matchVenues(
    venues.map((v) => ({ ...v, min_spend_inr: Number(v.min_spend_inr) })),
    filters,
    policy
  );
  tracer.annotate({ venuesConsidered: venues.length, options: options.length });

  return Response.json({ filters, options });
}

export const POST = tracer.traceResponse("api.ai.source-venues", handleSourceVenues);
