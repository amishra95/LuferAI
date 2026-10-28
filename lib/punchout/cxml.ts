/**
 * cXML PunchOut (cXML 1.2): what procurement systems (Coupa, SAP Ariba,
 * Oracle, Jaggaer) send and expect back.
 *
 *   PunchOutSetupRequest  → we answer with a StartPage URL for the shop
 *   PunchOutOrderMessage  ← the cart we hand back through the buyer's browser
 *   OrderRequest          → the approved purchase order for that cart
 *
 * Parsing never resolves entities: the standard `<!DOCTYPE cXML SYSTEM …>`
 * line is dropped, and a document with an internal DTD subset is refused.
 * Pure: tests import it directly (tests/punchout.test.mjs).
 */

import { XMLParser } from "fast-xml-parser";

export const CXML_VERSION = "1.2.014";
const DOCTYPE = `<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/${CXML_VERSION}/cXML.dtd">`;
/** Largest cXML document accepted (a PO with a few hundred lines is well under this). */
export const MAX_CXML_BYTES = 512 * 1024;

export class CxmlError extends Error {
  /** cXML status code to answer with: 400 bad request, 401 unauthorised, 406 not acceptable… */
  readonly code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  trimValues: true,
  isArray: (name) => ["Credential", "ItemOut", "ItemIn", "Extrinsic", "Email"].includes(name),
});

/** Parses a cXML document to its root <cXML> node; refuses DTD internals and oversized input. */
export function parseCxml(xml: string): Node {
  if (xml.length > MAX_CXML_BYTES) throw new CxmlError("Document too large.", 413);
  if (/<!DOCTYPE[^>]*\[/i.test(xml) || /<!ENTITY/i.test(xml)) throw new CxmlError("DTD declarations aren't accepted.");
  const body = xml.replace(/<!DOCTYPE[^>[]*>/gi, "");
  let doc: Node;
  try {
    doc = parser.parse(body, true) as Node;
  } catch {
    throw new CxmlError("Malformed XML.");
  }
  const root = doc.cXML;
  if (!root || typeof root !== "object") throw new CxmlError("Not a cXML document.");
  return root as Node;
}

const obj = (v: unknown): Node | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : undefined);
const list = (v: unknown): Node[] => (Array.isArray(v) ? v.filter((x): x is Node => Boolean(obj(x))) : obj(v) ? [v as Node] : []);
/** Text of an element that may carry attributes (xml:lang…). */
const text = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  const t = obj(v)?.["#text"];
  return typeof t === "string" || typeof t === "number" ? String(t).trim() || null : null;
};
const attr = (n: Node | undefined, name: string) => {
  const v = n?.[`@_${name}`];
  return typeof v === "string" ? v : null;
};

export interface SenderCredential {
  domain: string | null;
  identity: string;
  sharedSecret: string;
}

/** The Sender credential: who is calling, and the secret that proves it. */
export function senderOf(root: Node): SenderCredential {
  const cred = list(obj(obj(root.Header)?.Sender)?.Credential)[0];
  const identity = text(cred?.Identity);
  const sharedSecret = text(cred?.SharedSecret);
  if (!identity || !sharedSecret) throw new CxmlError("Missing Sender credential.", 401);
  return { domain: attr(cred, "domain"), identity, sharedSecret };
}

export interface SetupRequest {
  payloadId: string | null;
  operation: "create" | "edit" | "inspect";
  buyerCookie: string;
  browserFormPost: string;
  email: string | null;
  name: string | null;
}

export function parseSetupRequest(root: Node): SetupRequest {
  const req = obj(obj(root.Request)?.PunchOutSetupRequest);
  if (!req) throw new CxmlError("Expected a PunchOutSetupRequest.");
  const operation = attr(req, "operation") ?? "create";
  if (!["create", "edit", "inspect"].includes(operation)) throw new CxmlError(`Unsupported operation "${operation}".`, 406);
  const buyerCookie = text(req.BuyerCookie);
  if (!buyerCookie || buyerCookie.length > 512) throw new CxmlError("Missing BuyerCookie.");
  const browserFormPost = text(obj(req.BrowserFormPost)?.URL);
  if (!browserFormPost || !isHttpsUrl(browserFormPost)) throw new CxmlError("BrowserFormPost URL must be https.");
  const extrinsic = (name: string) => text(list(req.Extrinsic).find((e) => attr(e, "name") === name));
  const contact = obj(req.Contact);
  const email = extrinsic("UserEmail") ?? text(list(contact?.Email)[0]);
  return {
    payloadId: attr(root, "payloadID"),
    operation: operation as SetupRequest["operation"],
    buyerCookie,
    browserFormPost,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase().slice(0, 254) : null,
    name: (extrinsic("UserFullName") ?? text(contact?.Name))?.slice(0, 120) ?? null,
  };
}

export interface OrderLine {
  lineNumber: number;
  quantity: number;
  supplierPartId: string;
  auxiliaryId: string | null;
  unitPrice: number;
  currency: string;
  description: string | null;
}

export interface OrderRequest {
  payloadId: string;
  orderId: string;
  orderDate: string | null;
  type: string;
  total: number | null;
  currency: string;
  lines: OrderLine[];
}

const money = (n: Node | undefined) => {
  const m = obj(n?.Money);
  const value = Number(text(m) ?? NaN);
  return { value, currency: attr(m, "currency") ?? "" };
};

export function parseOrderRequest(root: Node): OrderRequest {
  const payloadId = attr(root, "payloadID");
  if (!payloadId) throw new CxmlError("Missing payloadID.");
  const req = obj(obj(root.Request)?.OrderRequest);
  const header = obj(req?.OrderRequestHeader);
  if (!req || !header) throw new CxmlError("Expected an OrderRequest.");
  const orderId = attr(header, "orderID");
  if (!orderId) throw new CxmlError("Missing orderID.");
  const total = money(obj(header.Total));
  const lines = list(req.ItemOut).map((item, i): OrderLine => {
    const id = obj(item.ItemID);
    const detail = obj(item.ItemDetail);
    const price = money(obj(detail?.UnitPrice));
    const quantity = Number(attr(item, "quantity"));
    const supplierPartId = text(id?.SupplierPartID);
    if (!supplierPartId) throw new CxmlError(`Line ${i + 1}: missing SupplierPartID.`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new CxmlError(`Line ${i + 1}: quantity must be a whole number above zero.`);
    if (!Number.isFinite(price.value) || price.value < 0) throw new CxmlError(`Line ${i + 1}: missing unit price.`);
    return {
      lineNumber: Number(attr(item, "lineNumber")) || i + 1,
      quantity,
      supplierPartId,
      auxiliaryId: text(id?.SupplierPartAuxiliaryID),
      unitPrice: price.value,
      currency: price.currency,
      description: text(detail?.Description)?.slice(0, 500) ?? null,
    };
  });
  if (!lines.length) throw new CxmlError("The order has no lines.");
  return {
    payloadId,
    orderId: orderId.slice(0, 120),
    orderDate: attr(header, "orderDate"),
    type: attr(header, "type") ?? "new",
    total: Number.isFinite(total.value) ? total.value : null,
    currency: total.currency || lines[0].currency,
    lines,
  };
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Building
// ----------------------------------------------------------------------------

export const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function envelope(payloadId: string, timestamp: string, inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${DOCTYPE}\n<cXML payloadID="${xmlEscape(payloadId)}" timestamp="${xmlEscape(timestamp)}" xml:lang="en-US">${inner}</cXML>`;
}

/** A bare <Response><Status/></Response>: acknowledgements and errors. */
export function statusResponse(payloadId: string, timestamp: string, code: number, message: string): string {
  return envelope(payloadId, timestamp, `<Response><Status code="${code}" text="${xmlEscape(code === 200 ? "OK" : "Error")}">${xmlEscape(message)}</Status></Response>`);
}

export function setupResponse(payloadId: string, timestamp: string, startPage: string): string {
  return envelope(
    payloadId,
    timestamp,
    `<Response><Status code="200" text="OK"/><PunchOutSetupResponse><StartPage><URL>${xmlEscape(startPage)}</URL></StartPage></PunchOutSetupResponse></Response>`
  );
}

export interface CartLine {
  itemId: string;
  name: string;
  quantity: number;
  /** Pre-GST unit price, INR. */
  unitPrice: number;
  /** HSN or SAC code. */
  taxCode: string;
  /** Unit of measure (UN/CEFACT): EA each, or a service. */
  uom?: string;
}

/**
 * The cart as a PunchOutOrderMessage. SupplierPartID is the catalogue item;
 * SupplierPartAuxiliaryID ties the line to this punchout session, so the
 * purchase order that follows can be matched to it.
 */
export function orderMessage(input: {
  payloadId: string;
  timestamp: string;
  buyerCookie: string;
  sessionId: string;
  fromIdentity: string;
  toIdentity: string;
  lines: readonly CartLine[];
}): string {
  const total = input.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const items = input.lines
    .map(
      (l) =>
        `<ItemIn quantity="${l.quantity}"><ItemID><SupplierPartID>${xmlEscape(l.itemId)}</SupplierPartID><SupplierPartAuxiliaryID>${xmlEscape(input.sessionId)}</SupplierPartAuxiliaryID></ItemID>` +
        `<ItemDetail><UnitPrice><Money currency="INR">${l.unitPrice.toFixed(2)}</Money></UnitPrice><Description xml:lang="en">${xmlEscape(l.name)}</Description>` +
        `<UnitOfMeasure>${xmlEscape(l.uom ?? "EA")}</UnitOfMeasure><Classification domain="HSN">${xmlEscape(l.taxCode)}</Classification></ItemDetail></ItemIn>`
    )
    .join("");
  const cred = (id: string) => `<Credential domain="NetworkID"><Identity>${xmlEscape(id)}</Identity></Credential>`;
  return envelope(
    input.payloadId,
    input.timestamp,
    `<Header><From>${cred(input.fromIdentity)}</From><To>${cred(input.toIdentity)}</To><Sender>${cred(input.fromIdentity)}<UserAgent>Lufer.ai</UserAgent></Sender></Header>` +
      `<Message><PunchOutOrderMessage><BuyerCookie>${xmlEscape(input.buyerCookie)}</BuyerCookie>` +
      `<PunchOutOrderMessageHeader operationAllowed="edit"><Total><Money currency="INR">${total.toFixed(2)}</Money></Total></PunchOutOrderMessageHeader>${items}</PunchOutOrderMessage></Message>`
  );
}

export interface LineCheck {
  lineNumber: number;
  itemId: string;
  quantity: number;
  ok: boolean;
  issue?: string;
}

/**
 * Matches a purchase order's lines to the carts they came from (by session
 * id, the SupplierPartAuxiliaryID): same item, from one of the buyer's sessions, in INR, at the cart's price (to the paisa), and no more
 * than was in the cart. The order is accepted only when every line checks out.
 */
export function matchOrderToCart(order: OrderRequest, carts: ReadonlyMap<string, readonly CartLine[]>): LineCheck[] {
  return order.lines.map((l) => {
    const base = { lineNumber: l.lineNumber, itemId: l.supplierPartId, quantity: l.quantity };
    const fail = (issue: string): LineCheck => ({ ...base, ok: false, issue });
    const cart = l.auxiliaryId ? carts.get(l.auxiliaryId) : undefined;
    if (!cart) return fail("Not from a Lufer.ai punchout session for this buyer.");
    if (l.currency && l.currency !== "INR") return fail(`Priced in ${l.currency}; Lufer.ai invoices in INR.`);
    const line = cart.find((c) => c.itemId === l.supplierPartId);
    if (!line) return fail("Not in the cart.");
    if (Math.round(l.unitPrice * 100) !== Math.round(line.unitPrice * 100)) return fail(`Unit price ₹${l.unitPrice.toFixed(2)} differs from the cart's ₹${line.unitPrice.toFixed(2)}.`);
    if (l.quantity > line.quantity) return fail(`Quantity ${l.quantity} is more than the ${line.quantity} in the cart.`);
    return { ...base, ok: true };
  });
}
