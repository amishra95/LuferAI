import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { dataSource, listCatalogItems, type CatalogItemDetail } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { matchOrderToCart, type CartLine, type OrderRequest, type SenderCredential, type SetupRequest, CxmlError } from "@/lib/punchout/cxml";

export type PunchoutConnection = Omit<Tables<"punchout_connections">, "shared_secret_sha256">;
export type PunchoutOrder = Tables<"punchout_orders">;

/** How long a punchout start page stays valid. */
const SESSION_HOURS = 2;
/** Our cXML identity on the cart we send back. */
export const supplierIdentity = () => (process.env.PUNCHOUT_SUPPLIER_IDENTITY ?? "").trim() || "lufer.app";

/** A reason an admin or shopper sees. */
export class PunchoutError extends Error {}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Postgres "relation does not exist": before migration 20261109000000. */
const missingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";
const CONNECTION_COLUMNS = "id, company_id, label, sender_identity, enabled, created_at, updated_at";

function db() {
  if (dataSource() !== "supabase") throw new PunchoutError("PunchOut needs the live database.");
  return createAdminClient();
}

// ----------------------------------------------------------------------------
// Connections (admins)
// ----------------------------------------------------------------------------

export async function listPunchoutConnections(companyId: string): Promise<{ connections: PunchoutConnection[]; orders: PunchoutOrder[]; ready: boolean }> {
  if (dataSource() !== "supabase") return { connections: [], orders: [], ready: false };
  const client = createAdminClient();
  const [conns, orders] = await Promise.all([
    client.from("punchout_connections").select(CONNECTION_COLUMNS).eq("company_id", companyId).order("created_at"),
    client.from("punchout_orders").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (missingTable(conns.error) || missingTable(orders.error)) return { connections: [], orders: [], ready: false };
  if (conns.error) throw conns.error;
  if (orders.error) throw orders.error;
  return { connections: conns.data, orders: orders.data, ready: true };
}

/** Creates a connection and returns its shared secret: the only time it's readable. */
export async function createPunchoutConnection(companyId: string, input: { label: string; senderIdentity: string }): Promise<{ connection: PunchoutConnection; sharedSecret: string }> {
  const label = input.label.trim();
  const senderIdentity = input.senderIdentity.trim();
  if (!label || label.length > 80) throw new PunchoutError("Name the connection, e.g. \"Coupa production\".");
  if (!senderIdentity || senderIdentity.length > 200) throw new PunchoutError("Enter the Sender identity the buyer's system sends (their network or Coupa ID).");
  const sharedSecret = randomBytes(24).toString("base64url");
  const { data, error } = await db()
    .from("punchout_connections")
    .insert({ company_id: companyId, label, sender_identity: senderIdentity, shared_secret_sha256: sha256(sharedSecret) })
    .select(CONNECTION_COLUMNS)
    .single();
  if (error?.code === "23505") throw new PunchoutError("Another connection already uses that Sender identity.");
  if (missingTable(error)) throw new PunchoutError("PunchOut needs database migration 20261109000000.");
  if (error) throw error;
  return { connection: data, sharedSecret };
}

export async function updatePunchoutConnection(companyId: string, id: string, change: "enable" | "disable" | "remove"): Promise<void> {
  const table = db().from("punchout_connections");
  const { error } = change === "remove" ? await table.delete().eq("id", id).eq("company_id", companyId) : await table.update({ enabled: change === "enable" }).eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}

/** The enabled connection whose identity and secret these are; one message for every failure. */
export async function authenticate(sender: SenderCredential): Promise<{ id: string; company_id: string; sender_identity: string }> {
  const { data, error } = await db().from("punchout_connections").select("id, company_id, sender_identity, shared_secret_sha256, enabled").eq("sender_identity", sender.identity).maybeSingle();
  if (error && !missingTable(error)) throw error;
  const expected = Buffer.from(data?.shared_secret_sha256 ?? "0".repeat(64), "hex");
  const given = Buffer.from(sha256(sender.sharedSecret), "hex");
  // Compare even when there's no connection, so timing doesn't reveal which identities exist.
  const match = timingSafeEqual(expected, given);
  if (!data || !data.enabled || !match) throw new CxmlError("Unknown sender or wrong shared secret.", 401);
  return data;
}

// ----------------------------------------------------------------------------
// Sessions (the shopper)
// ----------------------------------------------------------------------------

export async function startSession(connection: { id: string; company_id: string }, setup: SetupRequest): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await db()
    .from("punchout_sessions")
    .insert({
      connection_id: connection.id,
      company_id: connection.company_id,
      token_sha256: sha256(token),
      operation: setup.operation,
      buyer_cookie: setup.buyerCookie,
      browser_form_post: setup.browserFormPost,
      user_email: setup.email,
      user_name: setup.name,
      expires_at: new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString(),
    });
  if (error) throw error;
  return token;
}

export interface ShopSession {
  id: string;
  companyName: string;
  userName: string | null;
  operation: string;
  cart: CartLine[];
  returned: boolean;
  expiresAt: string;
}

const asCart = (raw: Json): CartLine[] => (Array.isArray(raw) ? (raw as unknown as CartLine[]) : []);

async function sessionRow(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { data, error } = await db().from("punchout_sessions").select("*, company:companies(legal_name), connection:punchout_connections(sender_identity, enabled)").eq("token_sha256", sha256(token)).maybeSingle();
  if (error && !missingTable(error)) throw error;
  type Row = Tables<"punchout_sessions"> & { company: { legal_name: string } | null; connection: { sender_identity: string; enabled: boolean } | null };
  const row = data as unknown as Row | null;
  if (!row || !row.connection?.enabled || Date.parse(row.expires_at) < Date.now()) return null;
  return row;
}

/** The session behind a start-page token, or null when unknown, expired or disconnected. */
export async function getShopSession(token: string): Promise<ShopSession | null> {
  const row = await sessionRow(token);
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.company?.legal_name ?? "your company",
    userName: row.user_name,
    operation: row.operation,
    cart: asCart(row.cart),
    returned: Boolean(row.returned_at),
    expiresAt: row.expires_at,
  };
}

/** What punchout shoppers can add: active catalogue items from suppliers who can invoice. */
export async function punchoutCatalog(): Promise<CatalogItemDetail[]> {
  return (await listCatalogItems()).filter((i) => i.partner_gstin);
}

/**
 * Replaces the cart. Prices, names and tax codes come from the catalogue, not
 * the browser; quantities are checked against each item's limits and stock.
 */
export async function saveCart(token: string, wanted: { itemId: string; quantity: number }[]): Promise<CartLine[]> {
  const row = await sessionRow(token);
  if (!row) throw new PunchoutError("This punchout session has expired. Start again from your procurement system.");
  if (row.returned_at) throw new PunchoutError("This cart was already sent back. Start a new punchout to change it.");
  if (row.operation === "inspect") throw new PunchoutError("This cart is view-only.");
  const items = new Map((await punchoutCatalog()).map((i) => [i.id, i]));
  const cart: CartLine[] = [];
  for (const w of wanted) {
    if (!Number.isInteger(w.quantity) || w.quantity <= 0) continue;
    const item = items.get(w.itemId);
    if (!item) throw new PunchoutError("An item in your cart is no longer available.");
    if (w.quantity < item.min_quantity) throw new PunchoutError(`${item.name}: order at least ${item.min_quantity}.`);
    if (item.max_quantity !== null && w.quantity > item.max_quantity) throw new PunchoutError(`${item.name}: at most ${item.max_quantity} per order.`);
    if (item.stock_quantity !== null && w.quantity > item.stock_quantity) throw new PunchoutError(`${item.name}: only ${item.stock_quantity} left.`);
    cart.push({ itemId: item.id, name: `${item.name} (${item.partner_name})`.slice(0, 200), quantity: w.quantity, unitPrice: Number(item.unit_price_inr), taxCode: item.tax_code });
  }
  if (cart.length > 100) throw new PunchoutError("A cart can have up to 100 lines.");
  const { error } = await db().from("punchout_sessions").update({ cart: cart as unknown as Json }).eq("id", row.id);
  if (error) throw error;
  return cart;
}

/** Closes the session and returns what the browser posts back to the procurement system. */
export async function returnCart(token: string): Promise<{ formPost: string; buyerCookie: string; sessionId: string; toIdentity: string; cart: CartLine[] }> {
  const row = await sessionRow(token);
  if (!row) throw new PunchoutError("This punchout session has expired. Start again from your procurement system.");
  const cart = asCart(row.cart);
  if (!row.returned_at) {
    const { error } = await db().from("punchout_sessions").update({ returned_at: new Date().toISOString() }).eq("id", row.id);
    if (error) throw error;
  }
  return { formPost: row.browser_form_post, buyerCookie: row.buyer_cookie, sessionId: row.id, toIdentity: row.connection!.sender_identity, cart };
}

// ----------------------------------------------------------------------------
// Purchase orders
// ----------------------------------------------------------------------------

/**
 * Records a purchase order, matched to the connection's own sessions. The
 * same payloadID again returns the first result (procurement systems retry).
 */
export async function receiveOrder(connection: { id: string; company_id: string }, order: OrderRequest): Promise<PunchoutOrder> {
  const client = db();
  const existing = await client.from("punchout_orders").select("*").eq("connection_id", connection.id).eq("payload_id", order.payloadId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const sessionIds = [...new Set(order.lines.map((l) => l.auxiliaryId).filter((id): id is string => Boolean(id && /^[0-9a-f-]{36}$/i.test(id))))];
  const { data: sessions, error } = sessionIds.length
    ? await client.from("punchout_sessions").select("id, cart").eq("connection_id", connection.id).in("id", sessionIds)
    : { data: [], error: null };
  if (error) throw error;
  const checks = matchOrderToCart(order, new Map(sessions.map((s) => [s.id, asCart(s.cart)])));
  const lines = order.lines.map((l, i) => ({ lineNumber: l.lineNumber, itemId: l.supplierPartId, quantity: l.quantity, unitPrice: l.unitPrice, description: l.description, ok: checks[i].ok, ...(checks[i].issue ? { issue: checks[i].issue } : {}) }));

  const { data, error: insertError } = await client
    .from("punchout_orders")
    .insert({
      connection_id: connection.id,
      company_id: connection.company_id,
      payload_id: order.payloadId,
      order_id: order.orderId,
      order_type: order.type,
      order_date: order.orderDate,
      total_inr: order.total,
      lines: lines as unknown as Json,
      status: checks.every((c) => c.ok) ? "received" : "needs_review",
    })
    .select("*")
    .single();
  // A concurrent retry won the insert: return its row.
  if (insertError?.code === "23505") {
    const again = await client.from("punchout_orders").select("*").eq("connection_id", connection.id).eq("payload_id", order.payloadId).single();
    if (again.error) throw again.error;
    return again.data;
  }
  if (insertError) throw insertError;
  return data;
}
