import { z } from "zod";

import { MAX_MESSAGE_CHARS } from "@/lib/venues/inquiry";
import { handleInquiryTurn, InquiryVenueNotFoundError } from "@/lib/venues/inquiry-agent";
import { tracer } from "@/lib/tracer";

/**
 * POST { venueId, token?, message } → the venue's inquiry agent's reply
 * (lib/venues/inquiry-agent.ts) and the token to continue with. Public: no
 * sign-in, so it's rate-limited per IP with the AI routes (lib/ratelimit.ts),
 * and a token only ever reaches its own conversation at its own venue.
 */
export const maxDuration = 60;

const Body = z.object({
  venueId: z.uuid(),
  token: z.string().max(64).nullish(),
  message: z.string().trim().min(1, "Type a message.").max(MAX_MESSAGE_CHARS, `Keep messages under ${MAX_MESSAGE_CHARS} characters.`),
});

async function handleInquiry(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  try {
    const turn = await handleInquiryTurn(parsed.data);
    tracer.annotate({ venue: parsed.data.venueId.slice(0, 8), status: turn.status, alternatives: turn.alternatives.length });
    return Response.json(turn, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof InquiryVenueNotFoundError) return Response.json({ error: err.message }, { status: 404 });
    console.error("inquiries: turn failed", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const POST = tracer.traceResponse("api.inquiries", handleInquiry);
