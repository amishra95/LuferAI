/**
 * The agreement template: terms in, an ordered list of sections out. Each
 * template is versioned; a contract stores the key and version it was issued
 * from, and changing wording means a new version, never editing one in place.
 *
 * This is a commercial template for the platform's standard booking terms,
 * not legal advice; have counsel review the wording before relying on it.
 *
 * Pure: tests import it directly (tests/contracts.test.mjs).
 */

import { describeCancellation } from "../../venues/profile.ts";
import type { ContractTerms } from "./terms.ts";

export const TEMPLATE = { key: "venue-services-agreement", version: "1.0" } as const;

export type Block =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; rows: [string, string][] };

export interface Section {
  heading: string;
  blocks: Block[];
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

export function sections(t: ContractTerms): Section[] {
  const p = t.pricing;
  const tax: [string, string][] =
    p.gstType === "IGST"
      ? [[`IGST ${p.gstRatePercent}%`, inr(p.igst)]]
      : [
          [`CGST ${p.gstRatePercent / 2}%`, inr(p.cgst)],
          [`SGST ${p.gstRatePercent / 2}%`, inr(p.sgst)],
        ];
  const event = t.event;
  const includes = [
    event.alcoholIncluded ? "alcoholic beverages, served in line with applicable law and the venue's licence" : "no alcoholic beverages",
    ...(event.entertainment.length ? [`entertainment: ${event.entertainment.map((e) => e.replace(/_/g, " ")).join(", ")}`] : []),
  ];

  return [
    {
      heading: "1. Parties",
      blocks: [
        {
          kind: "p",
          text: `This Venue Services Agreement (the "Agreement") is made between ${t.client.legalName}, GSTIN ${t.client.billingGstin ?? t.client.gstin} (the "Client"), and ${t.venue.legalName}, ${t.venue.address ? `${t.venue.address}, ` : ""}${t.venue.neighborhood}, ${t.venue.city}, GSTIN ${t.venue.gstin} (the "Venue"), for the event booked on the Lufer.ai platform under reference ${t.bookingId}.`,
        },
      ],
    },
    {
      heading: "2. The event",
      blocks: [
        {
          kind: "table",
          rows: [
            ["Date", date(event.date)],
            ["Guests", `${event.partySize}`],
            ["Includes", includes.join("; ")],
            ...(event.notes ? ([["Client brief", event.notes]] as [string, string][]) : []),
          ],
        },
        { kind: "p", text: "The Venue will provide the space, food and beverage and service for the event as described above. Changes to the date or guest count need both parties' written agreement and may require a new revision of this Agreement." },
      ],
    },
    {
      heading: "3. Price",
      blocks: [
        {
          kind: "table",
          rows: [
            ...(p.rateCardApplied && p.listPerHead !== null
              ? ([[`Per guest (list ${inr(p.listPerHead)}, corporate rate applied)`, inr(p.perHead)]] as [string, string][])
              : ([["Per guest", inr(p.perHead)]] as [string, string][])),
            [`Taxable value · SAC ${p.sacCode}`, inr(p.taxable)],
            ...tax,
            ["Total payable", inr(p.invoiceTotal)],
          ],
        },
        {
          kind: "p",
          text: `Prices are in Indian Rupees and include GST at ${p.gstRatePercent}% as shown (${p.gstType === "IGST" ? "inter-state supply" : "intra-state supply"}). The Venue will issue GST tax invoices for each instalment below.`,
        },
      ],
    },
    {
      heading: "4. Payment schedule",
      blocks: [
        {
          kind: "table",
          rows: t.payment.instalments.map((i) => [
            i.kind === "deposit" ? `Deposit (${pct(t.payment.depositRate)})` : "Balance",
            `${inr(i.total)} · due ${i.due === "on execution" ? "on signature of this Agreement" : date(i.due)}`,
          ]),
        },
        { kind: "p", text: "Each instalment is invoiced and collected through the platform. The booking is confirmed when both parties have signed; the deposit secures the date." },
      ],
    },
    {
      heading: "5. Venue terms",
      blocks: [
        {
          kind: "list",
          items: [
            t.venueRules.minimumSpend > 0 ? `Minimum spend for the venue: ${inr(t.venueRules.minimumSpend)} (pre-GST).` : "No venue-wide minimum spend applies.",
            t.venueRules.minimumPerHead > 0 ? `Minimum spend per guest: ${inr(t.venueRules.minimumPerHead)} (pre-GST).` : "No per-guest minimum applies.",
            `Cancellation by the Client: ${describeCancellation(t.venueRules.cancellation)}. Refunds are of the amounts paid, calculated on the notice given before the event date.`,
            "Cancellation by the Venue for reasons within its control entitles the Client to a full refund of all amounts paid.",
          ],
        },
      ],
    },
    {
      heading: "6. Client authorisation",
      blocks: [
        {
          kind: "table",
          rows: [
            ...(event.costCenter ? ([["Cost centre", event.costCenter]] as [string, string][]) : []),
            ...(event.projectCode ? ([["Project code", event.projectCode]] as [string, string][]) : []),
            ...(event.department ? ([["Department", event.department]] as [string, string][]) : []),
            ...(event.poNumber ? ([["Purchase order", event.poNumber]] as [string, string][]) : []),
          ],
        },
        t.approvals.length
          ? {
              kind: "list",
              items: t.approvals.map(
                (a) => `Step ${a.step}: approved by ${a.approverName}${a.decidedAt ? ` on ${date(a.decidedAt)}` : ""}${a.escalated ? " (escalated)" : ""}${a.note ? ` — “${a.note}”` : ""}`
              ),
            }
          : { kind: "p", text: "The booking was within the Client's spend policy and needed no internal sign-off." },
        ...(t.approvalReason ? [{ kind: "p", text: `Sign-off was required because ${t.approvalReason}.` } as Block] : []),
      ],
    },
    {
      heading: "7. General",
      blocks: [
        {
          kind: "list",
          items: [
            "Each party is responsible for its own compliance with applicable law, including licensing, food safety, and GST registration and returns.",
            "Neither party is liable for failure to perform caused by events beyond its reasonable control; amounts paid for services not provided are refunded.",
            "This Agreement is governed by the laws of India. It is signed electronically under the Information Technology Act, 2000; each signature records the signer, the time and a SHA-256 fingerprint of this document.",
            "This Agreement, with the booking it references, is the entire agreement between the parties for the event.",
          ],
        },
      ],
    },
  ];
}
