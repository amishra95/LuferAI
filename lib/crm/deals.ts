/**
 * CRM deals for tying entertainment spend to revenue.
 *
 * - `parseDealsCsv`: reads a deals/opportunities CSV export from Zoho CRM,
 *   HubSpot or Salesforce (or a hand-made one with the same headers) into rows
 *   for crm_deals. Headers are matched loosely, so each CRM's default export
 *   works as-is.
 * - `dealRoi`: spend per deal and the company's entertainment ROI.
 *
 * Pure: tests import it directly (tests/crm-deals.test.mjs).
 */

export const DEAL_PROVIDERS = ["manual", "zoho", "hubspot", "salesforce"] as const;
export type DealProvider = (typeof DEAL_PROVIDERS)[number];
export type DealStage = "open" | "won" | "lost";

export const PROVIDER_LABEL: Record<DealProvider, string> = { manual: "CSV", zoho: "Zoho CRM", hubspot: "HubSpot", salesforce: "Salesforce" };

export interface DealInput {
  provider: DealProvider;
  external_id: string;
  name: string;
  account_name: string | null;
  amount_inr: number;
  stage: DealStage;
  closed_on: string | null;
  owner_email: string | null;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Accepted header spellings per field, normalised (lowercase, no spaces or punctuation). */
const HEADERS = {
  id: ["recordid", "dealid", "opportunityid", "id", "externalid", "zcrmid"],
  name: ["dealname", "opportunityname", "name", "deal"],
  account: ["accountname", "associatedcompany", "company", "companyname", "account", "client"],
  amount: ["amount", "amountinr", "dealamount", "value", "expectedrevenue", "amountincompanycurrency"],
  stage: ["stage", "dealstage", "status"],
  closed: ["closingdate", "closedate", "closedon", "closeddate"],
  owner: ["dealowneremail", "owneremail", "dealowner", "opportunityowner", "owner", "hubspotowner"],
} as const;

/** Which CRM an export came from, by its id column. */
function detectProvider(headers: string[]): DealProvider {
  if (headers.includes("opportunityid") || headers.includes("opportunityname")) return "salesforce";
  if (headers.includes("recordid") && headers.includes("dealstage")) return "hubspot";
  if (headers.includes("zcrmid") || headers.includes("closingdate")) return "zoho";
  return "manual";
}

/** won / lost / open from any CRM's stage label ("Closed Won", "closedwon", "Closed (Lost)", "Negotiation"…). */
export function normaliseStage(raw: string): DealStage {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("won") || s === "win") return "won";
  if (s.includes("lost") || s.includes("lose")) return "lost";
  return "open";
}

/** "₹ 12,50,000.00", "INR 1250000", "1250000" → 1250000. NaN when unreadable. */
export function parseAmount(raw: string): number {
  const cleaned = raw.replace(/inr|rs\.?|₹|,|\s/gi, "");
  if (cleaned === "") return 0;
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

/** ISO, DD/MM/YYYY (Zoho India), DD-MM-YYYY, or "YYYY-MM-DD hh:mm" → YYYY-MM-DD, else null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export const MAX_IMPORT_ROWS = 5000;

export interface ParsedDeals {
  provider: DealProvider;
  deals: DealInput[];
  errors: { line: number; error: string }[];
}

export function parseDealsCsv(text: string): ParsedDeals {
  const rows = parseCsv(text);
  if (rows.length === 0) return { provider: "manual", deals: [], errors: [{ line: 1, error: "The file is empty." }] };
  const headers = rows[0].map(norm);
  const col = (field: keyof typeof HEADERS) => {
    for (const h of HEADERS[field]) {
      const i = headers.indexOf(h);
      if (i !== -1) return i;
    }
    return -1;
  };
  const idx = { id: col("id"), name: col("name"), account: col("account"), amount: col("amount"), stage: col("stage"), closed: col("closed"), owner: col("owner") };
  const missing = (["id", "name"] as const).filter((k) => idx[k] === -1);
  if (missing.length) {
    return { provider: "manual", deals: [], errors: [{ line: 1, error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((k) => (k === "id" ? "Deal ID / Record ID" : "Deal Name")).join(", ")}.` }] };
  }
  const provider = detectProvider(headers);
  const deals: DealInput[] = [];
  const errors: ParsedDeals["errors"] = [];
  const seen = new Set<string>();
  const get = (r: string[], i: number) => (i === -1 ? "" : (r[i] ?? "").trim());

  for (let n = 1; n < rows.length; n++) {
    const line = n + 1;
    if (deals.length >= MAX_IMPORT_ROWS) {
      errors.push({ line, error: `Only the first ${MAX_IMPORT_ROWS} deals are imported.` });
      break;
    }
    const r = rows[n];
    const id = get(r, idx.id).slice(0, 120);
    const name = get(r, idx.name).slice(0, 200);
    if (!id || !name) {
      errors.push({ line, error: "Needs a deal ID and a name." });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ line, error: `Deal ID ${id} appears twice; kept the first.` });
      continue;
    }
    const amount = parseAmount(get(r, idx.amount));
    if (Number.isNaN(amount)) {
      errors.push({ line, error: `Amount "${get(r, idx.amount)}" isn't a number.` });
      continue;
    }
    const stage = normaliseStage(get(r, idx.stage));
    const owner = get(r, idx.owner);
    seen.add(id);
    deals.push({
      provider,
      external_id: id,
      name,
      account_name: get(r, idx.account).slice(0, 200) || null,
      amount_inr: Math.round(amount * 100) / 100,
      stage,
      closed_on: stage === "open" ? null : parseDate(get(r, idx.closed)),
      owner_email: owner.includes("@") ? owner.slice(0, 254) : null,
    });
  }
  return { provider, deals, errors };
}

// ----------------------------------------------------------------------------
// ROI
// ----------------------------------------------------------------------------

export interface RoiDeal {
  id: string;
  name: string;
  account_name: string | null;
  amount_inr: number;
  stage: DealStage;
  closed_on: string | null;
}

/** A booking's spend (invoice total incl. GST) and the deal it entertained for. */
export interface RoiBooking {
  id: string;
  crm_deal_id: string | null;
  status: string;
  spend_inr: number;
}

export interface DealRoiRow extends RoiDeal {
  bookings: number;
  spend: number;
  /** Deal value per rupee of entertainment, for won deals; null before then or with no spend. */
  multiple: number | null;
}

export interface RoiSummary {
  deals: DealRoiRow[];
  /** Spend linked to any deal / to none. */
  linkedSpend: number;
  unlinkedSpend: number;
  /** Open deals' value that had entertainment. */
  influencedPipeline: number;
  /** Won deals' value that had entertainment, and the spend on them. */
  wonRevenue: number;
  wonSpend: number;
  /** Won revenue per rupee of all linked spend (won, lost and open). */
  roiMultiple: number | null;
  /** Of entertained deals that closed, the share won. */
  winRate: number | null;
  /** The same for deals with no entertainment, to compare. */
  baselineWinRate: number | null;
}

/** Bookings that count as spend: confirmed onwards. */
const SPEND_STATUSES = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function dealRoi(deals: readonly RoiDeal[], bookings: readonly RoiBooking[]): RoiSummary {
  const per = new Map<string, { bookings: number; spend: number }>();
  let linkedSpend = 0;
  let unlinkedSpend = 0;
  const known = new Set(deals.map((d) => d.id));
  for (const b of bookings) {
    if (!SPEND_STATUSES.has(b.status)) continue;
    if (b.crm_deal_id && known.has(b.crm_deal_id)) {
      const p = per.get(b.crm_deal_id) ?? { bookings: 0, spend: 0 };
      p.bookings++;
      p.spend = r2(p.spend + b.spend_inr);
      per.set(b.crm_deal_id, p);
      linkedSpend = r2(linkedSpend + b.spend_inr);
    } else unlinkedSpend = r2(unlinkedSpend + b.spend_inr);
  }

  let influencedPipeline = 0;
  let wonRevenue = 0;
  let wonSpend = 0;
  const closed = { entertained: { won: 0, total: 0 }, other: { won: 0, total: 0 } };
  const rows: DealRoiRow[] = deals.map((d) => {
    const p = per.get(d.id) ?? { bookings: 0, spend: 0 };
    const entertained = p.bookings > 0;
    if (d.stage !== "open") {
      const bucket = entertained ? closed.entertained : closed.other;
      bucket.total++;
      if (d.stage === "won") bucket.won++;
    }
    if (entertained && d.stage === "open") influencedPipeline = r2(influencedPipeline + d.amount_inr);
    if (entertained && d.stage === "won") {
      wonRevenue = r2(wonRevenue + d.amount_inr);
      wonSpend = r2(wonSpend + p.spend);
    }
    return { ...d, bookings: p.bookings, spend: p.spend, multiple: d.stage === "won" && p.spend > 0 ? r2(d.amount_inr / p.spend) : null };
  });

  const rate = (b: { won: number; total: number }) => (b.total ? Math.round((b.won / b.total) * 1000) / 1000 : null);
  return {
    deals: rows.sort((a, b) => b.spend - a.spend || b.amount_inr - a.amount_inr || a.name.localeCompare(b.name)),
    linkedSpend,
    unlinkedSpend,
    influencedPipeline,
    wonRevenue,
    wonSpend,
    roiMultiple: linkedSpend > 0 ? r2(wonRevenue / linkedSpend) : null,
    winRate: rate(closed.entertained),
    baselineWinRate: rate(closed.other),
  };
}
