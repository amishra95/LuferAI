/**
 * Expense-system adapters: the same expense receipt (lib/finance/receipt.ts),
 * shaped for each destination a company can choose (companies.expense_provider).
 *
 *   webhook  the receipt as-is, HMAC-signed (the original integration)
 *   ramp     a card/reimbursement-style transaction with accounting fields
 *   brex     an expense with merchant, memo and metadata
 *   concur   an SAP Concur expense entry
 *
 * The provider shapes are a mapping layer, not a vendor SDK: each adapter turns
 * the receipt into a JSON body with amounts in minor units (paise) where the
 * provider expects them, and the endpoint and token come from env
 * (`<PROVIDER>_EXPENSE_URL`, `<PROVIDER>_API_TOKEN`). Check the field names
 * against the provider's current API before enabling one in production.
 *
 * Pure: tests import it directly (tests/corporate-venue-os.test.mjs).
 */
import type { ExpenseReceipt } from "./receipt.ts";

export const EXPENSE_PROVIDERS = ["webhook", "ramp", "brex", "concur"] as const;
export type ExpenseProvider = (typeof EXPENSE_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<ExpenseProvider, string> = { webhook: "Webhook", ramp: "Ramp", brex: "Brex", concur: "SAP Concur" };

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
  }
}

/** Env var names for a provider's endpoint and credential. */
export function providerEnv(provider: ExpenseProvider): { url: string; token: string } {
  if (provider === "webhook") return { url: "EXPENSE_WEBHOOK_URL", token: "EXPENSE_WEBHOOK_SECRET" };
  const p = provider.toUpperCase();
  return { url: `${p}_EXPENSE_URL`, token: `${p}_API_TOKEN` };
}
