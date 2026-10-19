import { NextResponse } from "next/server";

import { applyProviderCallback } from "@/lib/services/contracts/contractStore";
import { CALLBACK_ACK, CallbackVerificationError, verifyCallback } from "@/lib/services/contracts/dropboxSign";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

/**
 * POST /api/contracts/webhooks/dropbox-sign: Dropbox Sign account callbacks.
 * Set the account callback URL to this route. Each callback is verified by its
 * event_hash (HMAC-SHA256 of event_time + event_type with DROPBOX_SIGN_API_KEY),
 * then the signature request is re-fetched from the API and applied: signatures
 * recorded in order (the venue's executes the contract and confirms the
 * booking), declines and cancellations close it. Idempotent per event.
 *
 * Dropbox Sign posts multipart/form-data with the payload in a `json` field and
 * expects the body "Hello API Event Received"; anything else is retried.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/contracts/webhooks/[provider]">) {
  const { provider } = await ctx.params;
  if (provider !== "dropbox-sign") return NextResponse.json({ error: "unknown_provider" }, { status: 404 });
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey || !isSupabaseConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const type = request.headers.get("content-type") ?? "";
  let json: string;
  try {
    json = type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded") ? String((await request.formData()).get("json") ?? "") : await request.text();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let event;
  try {
    event = verifyCallback(json, apiKey);
  } catch (err) {
    if (err instanceof CallbackVerificationError) {
      console.warn(`Rejected Dropbox Sign callback: ${err.message}`);
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
    throw err;
  }

  try {
    await applyProviderCallback(event);
  } catch (err) {
    // 5xx → Dropbox Sign retries; events are idempotent on their id.
    console.error(`Failed to apply Dropbox Sign event ${event.eventId}`, err);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  return new Response(CALLBACK_ACK, { status: 200, headers: { "Content-Type": "text/plain" } });
}
