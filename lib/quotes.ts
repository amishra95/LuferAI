/**
 * Quote maths shared by checkout, the RFP broadcast and the comparison matrix.
 * Pure (no I/O) so it runs anywhere and is unit-tested in tests/quotes.test.mjs.
 * All money goes through lib/gst-engine so quotes, invoices and deposits agree
 * to the paisa with the Postgres triggers.
 */

import { calculateGst, roundInr, splitCommission, type TaxInvoicePayload } from "./gst-engine.ts";
import { applyRateCard, type RateCardTerms } from "./rates/apply-rate-card.ts";

/** Share of the GST-inclusive invoice total authorised as a deposit at request time. */
export const DEPOSIT_RATE = 0.25;

export const DIETARY_TAGS = ["vegetarian", "vegan", "jain", "halal", "gluten_free", "nut_free", "eggless"] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

const DIETARY_LABEL: Record<DietaryTag, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  jain: "Jain",
  halal: "Halal",
  gluten_free: "Gluten-free",
  nut_free: "Nut-free",
  eggless: "Eggless",
};

export const dietaryLabel = (tag: string) => DIETARY_LABEL[tag as DietaryTag] ?? tag;

// ----------------------------------------------------------------------------
// Discount + deposit
// ----------------------------------------------------------------------------

export interface PriceBreakdown {
  /** Party size × list per-head price. */
  list_amount: number;
  /** taxable − list: rate-card savings (negative) and any minimum-spend top-up (positive). */
  adjustment: number;
  taxable_value: number;
  invoice: TaxInvoicePayload;
}

/** Invoices a quote: list price for reference, GST on the taxable value actually charged. */
export function priceQuote(input: {
  listAmount: number;
  taxableValue: number;
  companyGstin: string;
  venueGstin: string;
  bookingId?: string;
  invoiceDate?: string;
}): PriceBreakdown {
  const invoice = calculateGst({
    total_amount: input.taxableValue,
    company_gstin: input.companyGstin,
    venue_gstin: input.venueGstin,
    booking_id: input.bookingId,
    invoice_date: input.invoiceDate,
  });
  return {
    list_amount: roundInr(input.listAmount),
    adjustment: roundInr(invoice.taxable_value - input.listAmount),
    taxable_value: invoice.taxable_value,
    invoice,
  };
}

/** Deposit on a GST-inclusive total, rounded half-up to the paisa. */
export function depositFor(invoiceTotal: number, rate: number = DEPOSIT_RATE): number {
  return splitCommission(invoiceTotal, rate).commission;
}

// ----------------------------------------------------------------------------
// Instant venue quote
// ----------------------------------------------------------------------------

export interface QuoteVenue {
  id: string;
  name: string;
  gstin: string;
  capacity_max: number;
  min_spend_inr: number;
  pdr_available: boolean;
}

export interface QuotePackage {
  id: string;
  name: string;
  per_head_inr: number;
  dietary_tags: string[];
  is_active: boolean;
}

export interface QuoteRequest {
  partySize: number;
  budgetPerHead: number | null;
  dietary: readonly string[];
  requiresPdr: boolean;
  /** The company's corporate_rate_cards row for this venue on the event date, if any. */
  rateCard: RateCardTerms | null;
  companyGstin: string;
}

export type VenueQuote =
  | {
      status: "quoted";
      menu_package_id: string;
      package_name: string;
      /** The package's list per-head price. */
      per_head_inr: number;
      rate_card_id: string | null;
      min_spend_applied: boolean;
      over_budget: boolean;
      price: PriceBreakdown;
    }
  | { status: "no_fit"; reason: string };

/**
 * Prices a venue against a brief: the dearest package that covers every dietary
 * need within budget (or the cheapest one if none fits the budget), the company's
 * corporate rate card, the (possibly overridden) minimum spend, then GST.
 */
export function quoteVenue(venue: QuoteVenue, packages: QuotePackage[], req: QuoteRequest): VenueQuote {
  if (venue.capacity_max < req.partySize) {
    return { status: "no_fit", reason: `Seats up to ${venue.capacity_max}` };
  }
  if (req.requiresPdr && !venue.pdr_available) {
    return { status: "no_fit", reason: "No private dining room" };
  }

  const eligible = packages
    .filter((p) => p.is_active && req.dietary.every((d) => p.dietary_tags.includes(d)))
    .sort((a, b) => a.per_head_inr - b.per_head_inr);
  if (eligible.length === 0) {
    const needs = req.dietary.map(dietaryLabel).join(", ");
    return { status: "no_fit", reason: needs ? `No package covers ${needs}` : "No active menu packages" };
  }

  const withinBudget = req.budgetPerHead == null ? eligible : eligible.filter((p) => p.per_head_inr <= req.budgetPerHead!);
  const pkg = withinBudget.at(-1) ?? eligible[0];

  // Corporate terms (lib/rates): discount or fixed per-head rate, and the card's
  // minimum-spend override. The quote is floored at the minimum spend.
  const terms = applyRateCard(req.rateCard, {
    partySize: req.partySize,
    perHead: pkg.per_head_inr,
    venueMinSpend: Number(venue.min_spend_inr),
  });
  const taxable = Math.max(terms.taxableTotal, terms.minimumSpend);

  return {
    status: "quoted",
    menu_package_id: pkg.id,
    package_name: pkg.name,
    per_head_inr: pkg.per_head_inr,
    rate_card_id: terms.rateCardId,
    min_spend_applied: !terms.meetsMinimumSpend,
    over_budget: withinBudget.length === 0,
    price: priceQuote({
      listAmount: roundInr(pkg.per_head_inr * req.partySize),
      taxableValue: taxable,
      companyGstin: req.companyGstin,
      venueGstin: venue.gstin,
    }),
  };
}

// ----------------------------------------------------------------------------
// Side-by-side comparison matrix (Markdown)
// ----------------------------------------------------------------------------

export interface MatrixColumn {
  venue: { name: string; neighborhood: string; capacity_max: number; pdr_available: boolean };
  status: "quoted" | "countered" | "declined" | "no_fit";
  package_name: string | null;
  per_head_inr: number | null;
  /** Present for quoted/countered responses. */
  price: PriceBreakdown | null;
  notes: string | null;
}

const STATUS_LABEL: Record<MatrixColumn["status"], string> = {
  quoted: "Instant quote",
  countered: "Venue counter-offer",
  declined: "Declined",
  no_fit: "Not a fit",
};

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Bids first (cheapest invoice total leftmost), then declines / non-fits. */
export function sortMatrixColumns(cols: MatrixColumn[]): MatrixColumn[] {
  const rank = (c: MatrixColumn) => (c.price ? 0 : 1);
  return [...cols].sort(
    (a, b) => rank(a) - rank(b) || (a.price?.invoice.invoice_total ?? 0) - (b.price?.invoice.invoice_total ?? 0)
  );
}

export function buildComparisonMatrix(
  rfp: { party_size: number; budget_per_head_inr: number | null; dietary_tags: string[]; event_date: string | null; city: string | null },
  columns: MatrixColumn[]
): string {
  const cols = sortMatrixColumns(columns);
  const dash = "—";
  const p = (c: MatrixColumn, f: (price: PriceBreakdown) => string) => (c.price ? f(c.price) : dash);

  const rows: [string, (c: MatrixColumn) => string][] = [
    ["Location", (c) => c.venue.neighborhood],
    ["Capacity", (c) => String(c.venue.capacity_max)],
    ["Private dining", (c) => (c.venue.pdr_available ? "Yes" : "No")],
    ["Response", (c) => STATUS_LABEL[c.status]],
    ["Menu package", (c) => c.package_name ?? dash],
    ["Per head", (c) => (c.per_head_inr != null ? inr(c.per_head_inr) : dash)],
    ["List price", (c) => p(c, (x) => inr(x.list_amount))],
    [
      "Rate card / min spend",
      (c) => p(c, (x) => (x.adjustment < 0 ? `−${inr(-x.adjustment)}` : x.adjustment > 0 ? `+${inr(x.adjustment)}` : dash)),
    ],
    ["Taxable value", (c) => p(c, (x) => inr(x.taxable_value))],
    ["GST", (c) => p(c, (x) => `${x.invoice.gst_type === "IGST" ? "IGST 18%" : "CGST 9% + SGST 9%"} · ${inr(x.invoice.total_tax)}`)],
    ["**Invoice total**", (c) => p(c, (x) => `**${inr(x.invoice.invoice_total)}**`)],
    [`Deposit (${Math.round(DEPOSIT_RATE * 100)}%)`, (c) => p(c, (x) => inr(depositFor(x.invoice.invoice_total)))],
    ["Notes", (c) => c.notes ?? dash],
  ];

  const brief = [
    `${rfp.party_size} guests`,
    rfp.budget_per_head_inr != null ? `budget ${inr(rfp.budget_per_head_inr)}/head` : null,
    rfp.event_date,
    rfp.city,
    rfp.dietary_tags.length ? rfp.dietary_tags.map(dietaryLabel).join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (cols.length === 0) return `**RFP:** ${brief}\n\n_No venues matched this brief._\n`;

  const header = `| | ${cols.map((c) => cell(`**${c.venue.name}**`)).join(" | ")} |`;
  const divider = `|---|${cols.map(() => "---").join("|")}|`;
  const body = rows.map(([label, f]) => `| ${label} | ${cols.map((c) => cell(f(c))).join(" | ")} |`);
  return [`**RFP:** ${brief}`, "", header, divider, ...body, ""].join("\n");
}
