import type { NextRequest } from "next/server";

import { authorize, data, failed } from "@/lib/api/respond";
import { canAccessWorkspace } from "@/lib/auth/roles";
import { listDirectory } from "@/lib/venues/directory";
import { applyVenueQuery, parseVenueQuery, withoutCommission } from "@/lib/venues/query";

/**
 * GET /api/venues — the venue directory (own venues + partner network), with the
 * same filters, sort and paging as /venues: ?q, tier, area, pdr, min, sort, dir, page, size.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize((m) => canAccessWorkspace(m.role, m.corporateRole, "/venues"));
  if ("response" in auth) return auth.response;

  try {
    const parsed = parseVenueQuery(Object.fromEntries(request.nextUrl.searchParams));
    const directory = await listDirectory();
    const { partners } = directory;
    const { venues, query } = auth.member.role === "ADMIN" ? { venues: directory.venues, query: parsed } : withoutCommission(directory.venues, parsed);
    const { rows, total, page, pageCount } = applyVenueQuery(venues, query);
    return data({ query, venues: rows, total, page, pageCount, areas: [...new Set(venues.map((v) => v.neighborhood))].sort(), partners });
  } catch (err) {
    return failed("api/venues", err);
  }
}
