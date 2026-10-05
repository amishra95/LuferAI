import { generateText, Output } from "ai";
import { z } from "zod";

import { AI_NOT_CONFIGURED, getLanguageModel } from "@/lib/ai/model";
import { matchVenues, venueSearchSchema } from "@/lib/ai/venue-sourcing";
import { getCurrentMember } from "@/lib/auth/session";
import { getCorporatePolicy, listCompanies, listVenues } from "@/lib/data";

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
export async function POST(req: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
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

  const companies = await listCompanies();
  if (!companies.some((c) => c.id === companyId)) {
    return Response.json({ error: "Unknown company account." }, { status: 404 });
  }

  let filters;
  try {
    ({ output: filters } = await generateText({
      model,
      output: Output.object({ schema: venueSearchSchema }),
      system:
        "You turn corporate event requests for venues in Bengaluru, India into search filters. " +
        "Amounts are INR. Convert totals to a per-head budget when the guest count is known. " +
        "Never invent values the request does not imply.",
      prompt,
    }));
  } catch (err) {
    console.error("source-venues: model call failed", err);
    return Response.json({ error: "Couldn't interpret that request. Try rephrasing it." }, { status: 502 });
  }

  const [venues, policy] = await Promise.all([listVenues(), getCorporatePolicy(companyId)]);
  const options = matchVenues(
    venues.map((v) => ({ ...v, min_spend_inr: Number(v.min_spend_inr) })),
    filters,
    policy
  );

  return Response.json({ filters, options });
}
