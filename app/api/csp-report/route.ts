import type { NextRequest } from "next/server";

import { safeUrl } from "@/lib/observability/redact";

/**
 * Receives Content-Security-Policy-Report-Only violations (lib/security-headers.ts) and
 * logs one JSON line each, so the policy can be tuned from real traffic before it's enforced.
 * Unauthenticated by design (browsers send these), so the body is capped and only a few
 * fields are kept; it always answers 204.
 */
const MAX_BODY = 8_192;

/** No query string, and RSVP / quote tokens masked. */
function pageOf(uri: unknown): string | undefined {
  return typeof uri === "string" ? safeUrl(uri) : undefined;
}

export async function POST(request: NextRequest) {
  const text = await request.text().catch(() => "");
  if (text.length > 0 && text.length <= MAX_BODY) {
    try {
      const parsed = JSON.parse(text);
      const report = parsed?.["csp-report"] ?? parsed;
      console.warn(
        JSON.stringify({
          type: "csp_violation",
          directive: report?.["violated-directive"] ?? report?.["effective-directive"],
          blocked: report?.["blocked-uri"],
          page: pageOf(report?.["document-uri"]),
          source: report?.["source-file"],
        }),
      );
    } catch {
      // Not JSON: ignore.
    }
  }
  return new Response(null, { status: 204 });
}
