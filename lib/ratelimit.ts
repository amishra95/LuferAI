import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sliding-window limiter for /api/ai/*: 10 requests per minute per user (or per IP when
 * signed out). Applied centrally in middleware.ts so every AI route is covered.
 *
 * Without UPSTASH_REDIS_REST_URL / _TOKEN the limiter is disabled and requests pass through.
 */
const ratelimit =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(10, "1 m"),
        prefix: "ratelimit:ai",
      })
    : null;

export function isAiApiPath(pathname: string): boolean {
  return pathname === "/api/ai" || pathname.startsWith("/api/ai/");
}

/** Client IP from the platform proxy headers (Vercel sets x-forwarded-for / x-real-ip). */
function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** A 429 JSON response when the caller is over the limit, otherwise null (let it through). */
export async function limitAiRequest(request: NextRequest, userId: string | null): Promise<NextResponse | null> {
  if (!ratelimit) return null;

  const identifier = userId ? `user:${userId}` : `ip:${clientIp(request)}`;
  let result: Awaited<ReturnType<Ratelimit["limit"]>>;
  try {
    result = await ratelimit.limit(identifier);
  } catch (err) {
    // A Redis outage shouldn't take the AI routes down with it.
    console.error("Rate limiter unavailable; allowing request", err);
    return null;
  }
  if (result.success) return null;

  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "rate_limited", message: "Too many requests. Please try again shortly.", retryAfter },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.reset),
      },
    }
  );
}
