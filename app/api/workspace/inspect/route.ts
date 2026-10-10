import type { NextRequest } from "next/server";

import { authorize, failed, json } from "@/lib/api/respond";
import { canInspect, loadEntity } from "@/lib/workspace/inspect";
import { isEntityId, isEntityKind } from "@/lib/workspace/state";

/**
 * GET /api/workspace/inspect?kind=agent|venue|trace|run&id=… — one entity's
 * details for the inspector sidebar. 404 when it doesn't exist or has aged out
 * of the run log / trace store.
 */
export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  const id = request.nextUrl.searchParams.get("id");
  if (!isEntityKind(kind) || !isEntityId(id)) return json({ error: "kind and a valid id are required" }, 400);

  const auth = await authorize((m) => canInspect(m, kind));
  if ("response" in auth) return auth.response;

  try {
    const entity = await loadEntity(kind, id);
    return entity ? json(entity) : json({ error: "not found" }, 404);
  } catch (err) {
    return failed("api/workspace/inspect", err);
  }
}
