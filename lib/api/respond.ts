import "server-only";

import { getCurrentMember, type Member } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";

/** Per-user data: never cached by the browser or a shared cache. */
const NO_STORE = { "Cache-Control": "private, no-store" };

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/** Wraps a GET data response with where the data came from (supabase | redis | mock). */
export const data = <T extends object>(body: T) => json({ source: dataSource(), ...body });

/**
 * The signed-in member, or the 401/403 response to return. `allow` decides access
 * from the member; scoping to their company or venue is the route's job.
 */
export async function authorize(allow: (m: Member) => boolean): Promise<{ member: Member } | { response: Response }> {
  const member = await getCurrentMember();
  if (!member) return { response: json({ error: "unauthenticated" }, 401) };
  if (!allow(member)) return { response: json({ error: "forbidden" }, 403) };
  return { member };
}

/** Logs and returns a 500 without leaking internals. */
export function failed(route: string, err: unknown) {
  console.error(`${route}: failed`, err);
  return json({ error: "Could not load data. Try again shortly." }, 500);
}
