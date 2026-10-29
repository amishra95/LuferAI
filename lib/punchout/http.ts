import "server-only";

import { randomUUID } from "node:crypto";

import { CxmlError, MAX_CXML_BYTES, parseCxml, statusResponse } from "@/lib/punchout/cxml";

export const payloadId = () => `${Date.now()}.${randomUUID()}@lufer.app`;
export const timestamp = () => new Date().toISOString();

export const xmlResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });

/** cXML errors answer in cXML (procurement systems read the Status), with a matching HTTP status. */
export function cxmlFailure(route: string, err: unknown): Response {
  if (err instanceof CxmlError) return xmlResponse(statusResponse(payloadId(), timestamp(), err.code, err.message), err.code);
  console.error(`${route}: failed`, err);
  return xmlResponse(statusResponse(payloadId(), timestamp(), 500, "Internal error. Try again shortly."), 500);
}

/** The request body as a cXML root node, refusing oversized bodies before reading them. */
export async function readCxml(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CXML_BYTES) throw new CxmlError("Document too large.", 413);
  const raw = await request.text();
  // Some systems post the document form-encoded as cxml-urlencoded.
  const xml = raw.trimStart().startsWith("<") ? raw : (new URLSearchParams(raw).get("cxml-urlencoded") ?? raw);
  return parseCxml(xml);
}
