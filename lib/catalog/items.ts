/**
 * The multi-category catalogue (migration 0021): categories, their
 * category-specific attributes, and how an order for an item is validated and
 * priced. One module so the partner form, the client order form, the booking
 * agent and the server share the same rules.
 *
 * Pure, with no path aliases: tests import it directly
 * (tests/catalog.test.mjs).
 */
import type { GstRate, TaxClassification } from "../gst-engine.ts";

export const CATEGORIES = ["dining", "gifting", "tickets", "merch", "team_building"] as const;
export type Category = (typeof CATEGORIES)[number];
export const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

export const CATEGORY_LABEL: Record<Category, string> = {
  dining: "Dining",
  gifting: "Gifting",
  tickets: "Tickets",
  merch: "Merch",
  team_building: "Team building",
};

/** Goods ship to recipients; the rest are services delivered at an event. */
export const SHIPS: Record<Category, boolean> = { dining: false, gifting: true, tickets: false, merch: true, team_building: false };

// ----------------------------------------------------------------------------
// Category attributes (catalog_items.attributes)
// ----------------------------------------------------------------------------

export interface TicketTier {
  name: string;
  price_inr: number;
  available: number;
}

export interface DiningAttributes { cuisine?: string; area?: string; contains_alcohol?: boolean; lead_time_days?: number }
export interface GiftingAttributes { contains_alcohol?: boolean; lead_time_days?: number; personalisation?: boolean }
export interface TicketAttributes { event_name: string; event_date: string; venue: string; event_state_code: string; tiers: TicketTier[] }
export interface MerchAttributes { sizes: string[]; lead_time_days?: number; customisable?: boolean }
export interface TeamBuildingAttributes { duration_hours: number; format: "onsite" | "offsite" | "virtual"; lead_time_days?: number }

export type ItemAttributes = DiningAttributes | GiftingAttributes | TicketAttributes | MerchAttributes | TeamBuildingAttributes;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const optText = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.trim().length <= max);
const optDays = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 120);
const optBool = (v: unknown) => v === undefined || typeof v === "boolean";

type Check<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates and cleans an item's attributes for its category. Unknown keys are dropped. */
export function validateAttributes(category: Category, raw: unknown): Check<ItemAttributes> {
  const a = isObj(raw) ? raw : {};
  switch (category) {
    case "dining":
      if (!optText(a.cuisine, 60) || !optText(a.area, 80) || !optBool(a.contains_alcohol) || !optDays(a.lead_time_days)) return { ok: false, error: "Check cuisine, area, alcohol and lead time." };
      return { ok: true, value: pick(a, ["cuisine", "area", "contains_alcohol", "lead_time_days"]) };
    case "gifting":
      if (!optBool(a.contains_alcohol) || !optDays(a.lead_time_days) || !optBool(a.personalisation)) return { ok: false, error: "Check alcohol, personalisation and lead time." };
      return { ok: true, value: pick(a, ["contains_alcohol", "lead_time_days", "personalisation"]) };
    case "tickets": {
      if (typeof a.event_name !== "string" || !a.event_name.trim() || a.event_name.length > 120) return { ok: false, error: "Tickets need the event name." };
      if (typeof a.event_date !== "string" || !ISO.test(a.event_date)) return { ok: false, error: "Tickets need the event date." };
      if (typeof a.venue !== "string" || !a.venue.trim()) return { ok: false, error: "Tickets need the venue." };
      if (typeof a.event_state_code !== "string" || !/^\d{2}$/.test(a.event_state_code)) return { ok: false, error: "Tickets need the event's GST state code (place of supply)." };
      const tiers = Array.isArray(a.tiers) ? a.tiers : [];
      const clean = tiers.filter(
        (t): t is TicketTier => isObj(t) && typeof t.name === "string" && t.name.trim() !== "" && typeof t.price_inr === "number" && t.price_inr >= 0 && Number.isInteger(t.available) && (t.available as number) >= 0
      );
      if (clean.length === 0 || clean.length !== tiers.length) return { ok: false, error: "Give each ticket tier a name, a price and the number available." };
      if (new Set(clean.map((t) => t.name.trim().toLowerCase())).size !== clean.length) return { ok: false, error: "Ticket tier names must be different." };
      return {
        ok: true,
        value: { event_name: a.event_name.trim(), event_date: a.event_date, venue: a.venue.trim(), event_state_code: a.event_state_code, tiers: clean.map((t) => ({ name: t.name.trim(), price_inr: t.price_inr, available: t.available })) },
      };
    }
    case "merch": {
      const sizes = Array.isArray(a.sizes) ? a.sizes.filter((s): s is string => typeof s === "string" && /^[A-Za-z0-9 ./-]{1,12}$/.test(s)) : [];
      if (sizes.length === 0) return { ok: false, error: "Merch needs at least one size (use “One size” if it has none)." };
      if (!optDays(a.lead_time_days) || !optBool(a.customisable)) return { ok: false, error: "Check lead time and customisation." };
      return { ok: true, value: { sizes: [...new Set(sizes)], ...pick(a, ["lead_time_days", "customisable"]) } };
    }
    case "team_building": {
      if (typeof a.duration_hours !== "number" || !(a.duration_hours > 0 && a.duration_hours <= 72)) return { ok: false, error: "Team building needs a duration in hours." };
      if (a.format !== "onsite" && a.format !== "offsite" && a.format !== "virtual") return { ok: false, error: "Team building format is onsite, offsite or virtual." };
      if (!optDays(a.lead_time_days)) return { ok: false, error: "Check the lead time." };
      return { ok: true, value: { duration_hours: a.duration_hours, format: a.format, ...pick(a, ["lead_time_days"]) } };
    }
  }
}

function pick<T>(a: Obj, keys: string[]): T {
  return Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, typeof a[k] === "string" ? (a[k] as string).trim() : a[k]])) as T;
}

// ----------------------------------------------------------------------------
// Items
// ----------------------------------------------------------------------------

export interface CatalogItemLike {
  id: string;
  partner_id: string;
  category: string;
  name: string;
  unit_price_inr: number;
  tax_kind: string;
  tax_code: string;
  gst_rate_percent: number;
  min_quantity: number;
  max_quantity: number | null;
  attributes: unknown;
  status: string;
}

export const leadTimeDays = (item: Pick<CatalogItemLike, "attributes">): number => {
  const d = isObj(item.attributes) ? item.attributes.lead_time_days : undefined;
  return Number.isInteger(d) ? (d as number) : 0;
};

export const containsAlcohol = (item: Pick<CatalogItemLike, "attributes">): boolean => isObj(item.attributes) && item.attributes.contains_alcohol === true;

export function taxOf(item: Pick<CatalogItemLike, "tax_kind" | "tax_code" | "gst_rate_percent" | "name" | "category">): TaxClassification {
  return {
    kind: item.tax_kind === "HSN" ? "HSN" : "SAC",
    code: item.tax_code,
    description: `${CATEGORY_LABEL[item.category as Category] ?? item.category}: ${item.name}`,
    rate_percent: item.gst_rate_percent as GstRate,
  };
}

// ----------------------------------------------------------------------------
// Orders: validation and pricing
// ----------------------------------------------------------------------------

export interface Recipient {
  name: string;
  address: string;
  email?: string;
  phone?: string;
  /** Merch only. */
  size?: string;
}

export interface OrderInput {
  quantity: number;
  /** Tickets, team building, dining. */
  eventDate?: string | null;
  /** Gifting, merch. */
  neededBy?: string | null;
  /** Tickets. */
  tier?: string | null;
  /** Gifting, merch: one per unit. */
  recipients?: Recipient[];
}

export interface PricedOrder {
  quantity: number;
  unitPrice: number;
  /** Pre-GST. */
  total: number;
  eventDate: string | null;
  neededBy: string | null;
  selections: Record<string, unknown>;
  recipients: Recipient[];
  tax: TaxClassification;
  /** Where the supply is taxed when it isn't the buyer's state (event admission). */
  placeOfSupplyState: string | null;
  /** For the spend policy: per head / per recipient. */
  perHead: number;
  alcohol: boolean;
}

const DAY_MS = 86_400_000;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cleanRecipients(raw: Recipient[] | undefined, sizes: string[] | null): Check<Recipient[]> {
  const list = raw ?? [];
  const out: Recipient[] = [];
  for (const [i, r] of list.entries()) {
    const n = i + 1;
    const name = String(r?.name ?? "").trim();
    const address = String(r?.address ?? "").trim();
    if (name.length < 2 || name.length > 80) return { ok: false, error: `Recipient ${n}: enter a name.` };
    if (address.length < 10 || address.length > 300) return { ok: false, error: `Recipient ${n}: enter a full delivery address.` };
    const email = String(r?.email ?? "").trim();
    if (email && !EMAIL.test(email)) return { ok: false, error: `Recipient ${n}: check the email.` };
    const phone = String(r?.phone ?? "").trim();
    if (phone && !/^\+?[0-9 -]{8,16}$/.test(phone)) return { ok: false, error: `Recipient ${n}: check the phone number.` };
    let size: string | undefined;
    if (sizes) {
      size = String(r?.size ?? "").trim();
      if (!sizes.includes(size)) return { ok: false, error: `Recipient ${n}: choose a size (${sizes.join(", ")}).` };
    }
    out.push({ name, address, ...(email && { email }), ...(phone && { phone }), ...(size && { size }) });
  }
  return { ok: true, value: out };
}

/**
 * Checks an order against its item and prices it. `today` is the buyer's date
 * (YYYY-MM-DD) for lead times. The returned total is pre-GST.
 */
export function priceOrder(item: CatalogItemLike, input: OrderInput, today: string): Check<PricedOrder> {
  if (item.status !== "active") return { ok: false, error: `${item.name} isn't available right now.` };
  if (!isCategory(item.category)) return { ok: false, error: "Unknown category." };
  const category = item.category;
  const attrs = validateAttributes(category, item.attributes);
  if (!attrs.ok) return { ok: false, error: `${item.name} is misconfigured: ${attrs.error}` };
  const lead = leadTimeDays(item);
  const earliest = addDays(today, Math.max(lead, 1));

  let quantity = input.quantity;
  let unitPrice = Number(item.unit_price_inr);
  let eventDate: string | null = null;
  let neededBy: string | null = null;
  let recipients: Recipient[] = [];
  let placeOfSupplyState: string | null = null;
  const selections: Record<string, unknown> = {};

  if (SHIPS[category]) {
    const sizes = category === "merch" ? (attrs.value as MerchAttributes).sizes : null;
    const r = cleanRecipients(input.recipients, sizes);
    if (!r.ok) return r;
    if (r.value.length === 0) return { ok: false, error: "Add at least one recipient." };
    recipients = r.value;
    quantity = recipients.length;
    if (!input.neededBy || !ISO.test(input.neededBy)) return { ok: false, error: "Choose the date it's needed by." };
    if (input.neededBy < earliest) return { ok: false, error: `${item.name} needs ${lead} days' notice: the earliest is ${earliest}.` };
    neededBy = input.neededBy;
    if (sizes) selections.sizes = Object.fromEntries(sizes.map((s) => [s, recipients.filter((x) => x.size === s).length]).filter(([, n]) => (n as number) > 0));
  } else if (category === "tickets") {
    const t = attrs.value as TicketAttributes;
    const tier = t.tiers.find((x) => x.name === input.tier);
    if (!tier) return { ok: false, error: `Choose a ticket tier (${t.tiers.map((x) => x.name).join(", ")}).` };
    if (t.event_date < earliest) return { ok: false, error: `${t.event_name} is too soon to book.` };
    if (quantity > tier.available) return { ok: false, error: `Only ${tier.available} ${tier.name} tickets are left.` };
    unitPrice = tier.price_inr;
    eventDate = t.event_date;
    placeOfSupplyState = t.event_state_code;
    selections.tier = tier.name;
  } else {
    if (!input.eventDate || !ISO.test(input.eventDate)) return { ok: false, error: "Choose the event date." };
    if (input.eventDate < earliest) return { ok: false, error: `${item.name} needs ${lead} days' notice: the earliest is ${earliest}.` };
    eventDate = input.eventDate;
  }

  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, error: "Enter a quantity." };
  if (quantity < item.min_quantity) return { ok: false, error: `${item.name} needs at least ${item.min_quantity} ${unitNoun(category, item.min_quantity)}.` };
  if (item.max_quantity !== null && quantity > item.max_quantity) return { ok: false, error: `${item.name} takes at most ${item.max_quantity} ${unitNoun(category, item.max_quantity)}.` };

  const total = round2(unitPrice * quantity);
  return {
    ok: true,
    value: {
      quantity,
      unitPrice,
      total,
      eventDate,
      neededBy,
      selections,
      recipients,
      tax: taxOf(item),
      placeOfSupplyState,
      perHead: round2(total / quantity),
      alcohol: containsAlcohol(item),
    },
  };
}

export function unitNoun(category: Category, n: number): string {
  const one = { dining: "guest", gifting: "gift", tickets: "ticket", merch: "item", team_building: "participant" }[category];
  return n === 1 ? one : `${one}s`;
}

// ----------------------------------------------------------------------------
// Items as a supplier enters them (the /partner catalogue form)
// ----------------------------------------------------------------------------

export interface ItemInput {
  category: Category;
  ref: string;
  name: string;
  description: string | null;
  unit_price_inr: number;
  tax_kind: "HSN" | "SAC";
  tax_code: string;
  gst_rate_percent: GstRate;
  min_quantity: number;
  max_quantity: number | null;
  attributes: ItemAttributes;
}

/** Validates a supplier's item (shape, tax code, quantities, category attributes). */
export function validateItemInput(raw: Record<string, unknown>): Check<ItemInput> {
  const category = raw.category;
  if (!isCategory(category)) return { ok: false, error: "Choose a category." };
  const ref = String(raw.ref ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(ref)) return { ok: false, error: "Ref: up to 32 letters, digits, . _ -" };
  const name = String(raw.name ?? "").trim();
  if (name.length < 2 || name.length > 120) return { ok: false, error: "Enter a name (2–120 characters)." };
  const description = String(raw.description ?? "").trim().slice(0, 1000) || null;
  const price = Number(raw.unit_price_inr);
  if (!(Number.isFinite(price) && price >= 0 && price < 1e9)) return { ok: false, error: "Enter the unit price." };
  const taxKind = raw.tax_kind === "HSN" ? "HSN" : raw.tax_kind === "SAC" ? "SAC" : null;
  if (!taxKind) return { ok: false, error: "Tax code type is HSN (goods) or SAC (services)." };
  const taxCode = String(raw.tax_code ?? "").trim();
  if (!/^[0-9]{4,8}$/.test(taxCode)) return { ok: false, error: "Tax code: 4–8 digits." };
  // Goods carry HSN codes and services SAC codes.
  if (SHIPS[category] && taxKind !== "HSN") return { ok: false, error: `${CATEGORY_LABEL[category]} items are goods: use an HSN code.` };
  if (!SHIPS[category] && taxKind !== "SAC") return { ok: false, error: `${CATEGORY_LABEL[category]} items are services: use a SAC code.` };
  const rate = Number(raw.gst_rate_percent);
  if (![0, 5, 12, 18, 28].includes(rate)) return { ok: false, error: "GST rate is 0, 5, 12, 18 or 28%." };
  const min = Number(raw.min_quantity ?? 1);
  const max = raw.max_quantity === null || raw.max_quantity === undefined || raw.max_quantity === "" ? null : Number(raw.max_quantity);
  if (!Number.isInteger(min) || min < 1) return { ok: false, error: "Minimum quantity is a whole number, at least 1." };
  if (max !== null && (!Number.isInteger(max) || max < min)) return { ok: false, error: "Maximum quantity must be at least the minimum." };
  const attributes = validateAttributes(category, raw.attributes);
  if (!attributes.ok) return attributes;
  return {
    ok: true,
    value: { category, ref, name, description, unit_price_inr: round2(price), tax_kind: taxKind, tax_code: taxCode, gst_rate_percent: rate as GstRate, min_quantity: min, max_quantity: max, attributes: attributes.value },
  };
}

/** "Name | address | size" per line → recipients (for pasting a list into the agent form). */
export function parseRecipientLines(text: string): Recipient[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", address = "", size = ""] = line.split("|").map((p) => p.trim());
      return { name, address, ...(size && { size }) };
    });
}
