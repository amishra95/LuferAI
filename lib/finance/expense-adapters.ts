/**
 * Expense-system adapters: the same expense receipt (lib/finance/receipt.ts),
 * shaped for each destination a company can choose (companies.expense_provider).
 *
 *   webhook  the receipt as-is, HMAC-signed (the original integration)
 *   ramp     a card/reimbursement-style transaction with accounting fields
 *   brex     an expense with merchant, memo and metadata
 *   concur   an SAP Concur expense entry
 *   zoho     a Zoho Expense itemised expense report (one expense, its lines and GST details)
 *   erpnext  an ERPNext Purchase Invoice (draft), with GST tax rows and ITC classification
 *
 * The provider shapes are a mapping layer, not a vendor SDK: each adapter turns
 * the receipt into a JSON body with amounts in minor units (paise) where the
 * provider expects them; endpoints and credentials come from env
 * (providerConnection). Check the field names against the provider's current
 * API before enabling one in production.
 *
 * Pure: tests import it directly (tests/corporate-venue-os.test.mjs).
 */
import type { ExpenseReceipt } from "./receipt.ts";

export const EXPENSE_PROVIDERS = ["webhook", "ramp", "brex", "concur", "zoho", "erpnext"] as const;
export type ExpenseProvider = (typeof EXPENSE_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<ExpenseProvider, string> = {
  webhook: "Webhook",
  ramp: "Ramp",
  brex: "Brex",
  concur: "SAP Concur",
  zoho: "Zoho Expense",
  erpnext: "ERPNext",
};

export const isExpenseProvider = (v: unknown): v is ExpenseProvider => typeof v === "string" && (EXPENSE_PROVIDERS as readonly string[]).includes(v);

/** INR → paise, exact for the 2-decimal amounts the GST engine produces. */
export const toMinorUnits = (inr: number) => Math.round(inr * 100);

export interface ExpenseRequest {
  provider: ExpenseProvider;
  /** JSON body to send. */
  body: unknown;
  /** Dedupe key for the receiver, stable per booking and event. */
  idempotencyKey: string;
  /** One-line description, for logs and the UI. */
  summary: string;
}

const memo = (r: ExpenseReceipt) =>
  `Corporate event · ${r.supplier.name} · ${r.booking.event_date} · ${r.amounts.party_size} guests${r.expense.cost_center ? ` · ${r.expense.cost_center}` : ""}`;

/** Cost centre / project as provider-neutral accounting coding. */
function coding(r: ExpenseReceipt): { field: string; value: string }[] {
  return [
    ...(r.expense.cost_center ? [{ field: "cost_center", value: r.expense.cost_center }] : []),
    ...(r.expense.project_code ? [{ field: "project_code", value: r.expense.project_code }] : []),
  ];
}

export function buildExpenseRequest(provider: ExpenseProvider, r: ExpenseReceipt): ExpenseRequest {
  const idempotencyKey = `${r.event}:${r.booking.id}`;
  const total = r.tax.invoice_total;
  const summary = `${PROVIDER_LABEL[provider]} · ${r.supplier.name} · ₹${total.toFixed(2)}`;
  switch (provider) {
    case "webhook":
      return { provider, body: r, idempotencyKey, summary };
    case "ramp":
      return {
        provider,
        idempotencyKey,
        summary,
        body: {
          external_id: r.booking.id,
          amount: { amount: toMinorUnits(total), currency_code: "INR" },
          transaction_date: r.booking.event_date,
          merchant_name: r.supplier.name,
          memo: memo(r),
          accounting_field_selections: coding(r),
          tax: { amount: toMinorUnits(r.tax.total_tax), gstin: r.supplier.gstin, itc_eligible: toMinorUnits(r.tax.itc_eligible_amount) },
          receipt_schema: r.schema,
        },
      };
    case "brex":
      return {
        provider,
        idempotencyKey,
        summary,
        body: {
          external_id: r.booking.id,
          amount: { amount: toMinorUnits(total), currency: "INR" },
          purchased_at: r.booking.event_date,
          merchant: { raw_descriptor: r.supplier.name, gstin: r.supplier.gstin },
          memo: memo(r),
          metadata: Object.fromEntries([...coding(r).map((c) => [c.field, c.value]), ["buyer_gstin", r.buyer.billed_gstin], ["sac_code", r.tax.sac_code]]),
        },
      };
    case "concur":
      return {
        provider,
        idempotencyKey,
        summary,
        body: {
          ExpenseTypeCode: "ENTERTAINMENT",
          TransactionDate: r.booking.event_date,
          TransactionAmount: total,
          TransactionCurrencyCode: "INR",
          VendorDescription: r.supplier.name,
          Description: memo(r),
          Custom1: r.expense.cost_center ?? "",
          Custom2: r.expense.project_code ?? "",
          TaxAmount: r.tax.total_tax,
          TaxReceiptNumber: r.booking.id,
          Comment: `GST ${r.tax.gst_type} · supplier ${r.supplier.gstin} · buyer ${r.buyer.billed_gstin}`,
        },
      };
    case "zoho":
      // One itemised expense, for POST /api/v1/expenses (it can then be added to a report in Zoho).
      return {
        provider,
        idempotencyKey,
        summary,
        body: {
          date: r.booking.event_date,
          merchant_name: r.supplier.name,
          currency_code: "INR",
          amount: total,
          reference_number: r.booking.id,
          description: memo(r),
          is_reimbursable: false,
          gst_no: r.supplier.gstin,
          source_of_supply: r.supplier.gstin.slice(0, 2),
          destination_of_supply: r.buyer.billed_gstin.slice(0, 2),
          line_items: taxLines(r).map((l) => ({ description: l.description, amount: l.amount, ...(l.sac && { hsn_or_sac: l.sac }) })),
          custom_fields: coding(r).map((c) => ({ label: c.field, value: c.value })).concat([{ label: "itc_status", value: r.tax.itc_status }]),
        },
      };
    case "erpnext": {
      const decided = r.tax.itc_status === "eligible" || r.tax.itc_status === "blocked" || r.tax.itc_status === "not_eligible";
      return {
        provider,
        idempotencyKey,
        summary,
        body: {
          doctype: "Purchase Invoice",
          // A draft: finance reviews and submits it in ERPNext.
          docstatus: 0,
          supplier: r.supplier.name,
          bill_no: r.booking.id,
          bill_date: r.booking.event_date,
          posting_date: r.booking.event_date,
          currency: "INR",
          supplier_gstin: r.supplier.gstin,
          company_gstin: r.buyer.billed_gstin,
          place_of_supply: r.buyer.place_of_supply.replace(" ", "-"),
          ...(r.expense.cost_center && { cost_center: r.expense.cost_center }),
          ...(r.expense.project_code && { project: r.expense.project_code }),
          // Only once finance has decided; until then the draft says so in remarks.
          ...(decided && { itc_classification: r.tax.itc_status === "eligible" ? "All Other ITC" : "Ineligible" }),
          items: [
            {
              item_name: "Corporate event",
              description: memo(r),
              qty: r.amounts.party_size,
              rate: r.amounts.per_head,
              amount: r.tax.taxable_value,
              gst_hsn_code: r.tax.sac_code,
              uom: "Nos",
            },
          ],
          taxes: taxLines(r)
            .filter((l) => l.head)
            .map((l) => ({ charge_type: "Actual", account_head: `Input Tax ${l.head}`, description: l.description, tax_amount: l.amount })),
          remarks: `${memo(r)} · ITC: ${r.tax.itc_status.replace(/_/g, " ")} · tags: ${r.tax.itc_tags.join(", ")}`,
        },
      };
    }
  }
}

/** The receipt as itemised lines: the taxable service, then each GST head with an amount. */
export function taxLines(r: ExpenseReceipt): { description: string; amount: number; sac?: string; head?: "CGST" | "SGST" | "IGST" }[] {
  const lines: { description: string; amount: number; sac?: string; head?: "CGST" | "SGST" | "IGST" }[] = [
    { description: `Event services (SAC ${r.tax.sac_code}), ${r.amounts.party_size} × ₹${r.amounts.per_head}`, amount: r.tax.taxable_value, sac: r.tax.sac_code },
  ];
  if (r.tax.cgst) lines.push({ description: "CGST", amount: r.tax.cgst, head: "CGST" });
  if (r.tax.sgst) lines.push({ description: "SGST", amount: r.tax.sgst, head: "SGST" });
  if (r.tax.igst) lines.push({ description: "IGST", amount: r.tax.igst, head: "IGST" });
  return lines;
}

/** The env vars each provider reads (first set name wins; later ones are older names). */
export const PROVIDER_ENV = {
  webhook: { url: ["EXPENSE_WEBHOOK_URL"], secret: ["EXPENSE_WEBHOOK_SECRET"] },
  ramp: { url: ["RAMP_EXPENSE_URL"], token: ["RAMP_API_TOKEN"] },
  brex: { url: ["BREX_EXPENSE_URL"], token: ["BREX_API_TOKEN"] },
  concur: { url: ["CONCUR_EXPENSE_URL"], token: ["CONCUR_API_TOKEN"] },
  zoho: { url: ["ZOHO_EXPENSE_URL"], token: ["ZOHO_EXPENSE_AUTH_TOKEN", "ZOHO_API_TOKEN"], organization: ["ZOHO_EXPENSE_ORGANIZATION_ID"] },
  erpnext: { url: ["ERPNEXT_URL", "ERPNEXT_EXPENSE_URL"], key: ["ERPNEXT_API_KEY"], secret: ["ERPNEXT_API_SECRET"] },
} as const satisfies Record<ExpenseProvider, Record<string, readonly string[]>>;

/** An OAuth access token from the vault (lib/auth/token-rotator.ts accessTokenFor), used over env. */
export interface VaultCredentials {
  accessToken: string;
  organizationId: string | null;
}

/**
 * Where a provider's exports go and how they authenticate, from env:
 *   ramp / brex / concur   Authorization: Bearer <token>
 *   zoho                   Authorization: Zoho-oauthtoken <token>, plus
 *                          X-com-zoho-expense-organizationid when set
 *   erpnext                Authorization: token <api key>:<api secret>, or
 *                          Bearer <OAuth access token> from the vault
 *   webhook                no header; the caller signs the body (X-Lufer-Signature)
 * For Zoho and ERPNext, `vault` (a refreshed OAuth token) wins over env.
 * An empty url means nothing is sent (the export is recorded as mocked).
 * Spaces in the URL (ERPNext's "/api/resource/Purchase Invoice") are encoded.
 */
export function providerConnection(provider: ExpenseProvider, env: (name: string) => string, vault: VaultCredentials | null = null): { url: string; headers: Record<string, string> } {
  const names: Record<string, readonly string[]> = PROVIDER_ENV[provider];
  const read = (k: string) => (names[k] ?? []).map((n) => env(n).trim()).find(Boolean) ?? "";
  const url = read("url").replace(/ /g, "%20");
  switch (provider) {
    case "webhook":
      return { url, headers: {} };
    case "zoho": {
      const token = vault?.accessToken || read("token");
      const organization = vault?.organizationId || read("organization");
      return { url, headers: { ...(token && { Authorization: `Zoho-oauthtoken ${token}` }), ...(organization && { "X-com-zoho-expense-organizationid": organization }) } };
    }
    case "erpnext": {
      if (vault?.accessToken) return { url, headers: { Authorization: `Bearer ${vault.accessToken}` } };
      const [key, secret] = [read("key"), read("secret")];
      return { url, headers: key && secret ? { Authorization: `token ${key}:${secret}` } : {} };
    }
    default: {
      const token = read("token");
      return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} };
    }
  }
}
