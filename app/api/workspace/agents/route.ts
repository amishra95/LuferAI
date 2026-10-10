import { authorize, failed, json } from "@/lib/api/respond";
import { canInspect, listAgentSummaries } from "@/lib/workspace/inspect";

/** GET /api/workspace/agents — configured agents and their status, for the ⌘K palette. */
export async function GET() {
  const auth = await authorize((m) => canInspect(m, "agent"));
  if ("response" in auth) return auth.response;

  try {
    return json({ agents: await listAgentSummaries() });
  } catch (err) {
    return failed("api/workspace/agents", err);
  }
}
