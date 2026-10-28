"use server";

import { randomUUID } from "node:crypto";

import { orderMessage } from "@/lib/punchout/cxml";
import { PunchoutError, returnCart, saveCart, supplierIdentity } from "@/lib/punchout/store";

export type ReturnCartResult = { ok: true; formPost: string; cxml: string } | { ok: false; error: string };

/**
 * Saves the cart and closes the session, returning the PunchOutOrderMessage
 * the browser posts to the procurement system (BrowserFormPost). The token in
 * the URL is the shopper's only credential, as with RSVP links.
 */
export async function returnCartAction(token: string, lines: { itemId: string; quantity: number }[], save: boolean): Promise<ReturnCartResult> {
  try {
    if (save) await saveCart(token, lines.slice(0, 100));
    const session = await returnCart(token);
    const cxml = orderMessage({
      payloadId: `${Date.now()}.${randomUUID()}@lufer.ai`,
      timestamp: new Date().toISOString(),
      buyerCookie: session.buyerCookie,
      sessionId: session.sessionId,
      fromIdentity: supplierIdentity(),
      toIdentity: session.toIdentity,
      lines: session.cart,
    });
    return { ok: true, formPost: session.formPost, cxml };
  } catch (err) {
    if (err instanceof PunchoutError) return { ok: false, error: err.message };
    console.error("punchout: return cart failed", err);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
