/**
 * The "venue accepted your request" message (subject, plain text, HTML) from a
 * confirmed booking. Pure (no server imports), so tests/property-delivery.test.mjs
 * checks the exact wording and figures; lib/services/notifications.ts sends it.
 */

export interface AcceptedBooking {
  bookingId: string;
  venueName: string;
  venueArea: string;
  /** YYYY-MM-DD */
  eventDate: string;
  partySize: number;
  perHead: number;
  companyName: string;
  invoice: {
    gst_type: "CGST_SGST" | "IGST" | string;
    taxable_value: number;
    tax_breakup: { cgst: { amount: number }; sgst: { amount: number }; igst: { amount: number } };
    total_tax: number;
    invoice_total: number;
  };
  /** Absolute link to the booking's page (voucher, invoice lines, guest list). */
  bookingUrl: string;
  /** Who it's addressed to, if known. */
  recipientName?: string | null;
}

const DATE = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "Thu, 18 Mar 2027", whatever punctuation the runtime's locale data adds. */
const formatDate = (iso: string) => {
  const part = Object.fromEntries(DATE.formatToParts(new Date(`${iso}T00:00:00Z`)).map((p) => [p.type, p.value]));
  return `${part.weekday}, ${part.day} ${part.month} ${part.year}`;
};
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
/** The booking's short reference: the id's first 8 characters, upper-cased. */
export const bookingRef = (id: string) => id.slice(0, 8).toUpperCase();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function bookingAcceptedMessage(b: AcceptedBooking): { subject: string; text: string; html: string } {
  const date = formatDate(b.eventDate);
  const subject = `Good news! ${b.venueName} has accepted your event request for ${date}`;
  const tax =
    b.invoice.gst_type === "IGST"
      ? [["IGST 18%", b.invoice.tax_breakup.igst.amount]]
      : [
          ["CGST 9%", b.invoice.tax_breakup.cgst.amount],
          ["SGST 9%", b.invoice.tax_breakup.sgst.amount],
        ];
  const rows: [string, string][] = [
    // The short reference the app shows (and ⌘K finds), with the full id after it.
    ["Booking ID", `${bookingRef(b.bookingId)} (${b.bookingId})`],
    ["Venue", `${b.venueName}, ${b.venueArea}`],
    ["Date", date],
    ["Guests", String(b.partySize)],
    ["Per head (locked)", INR.format(b.perHead)],
    ["Taxable value", INR.format(b.invoice.taxable_value)],
    ...tax.map(([label, amount]) => [label, INR.format(Number(amount))] as [string, string]),
    ["Invoice total", INR.format(b.invoice.invoice_total)],
  ];
  const greeting = b.recipientName ? `Hi ${b.recipientName},` : "Hello,";
  const intro = `${b.venueName} has accepted ${b.companyName}'s event request. Your booking is confirmed and the price is locked.`;

  const text = [
    greeting,
    "",
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `View your booking voucher and invoice: ${b.bookingUrl}`,
    "",
    "GST is invoiced under SAC 998596 and claimable as input tax credit.",
    "— Lufer",
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#faf6f0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#2a1b3d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #ece4d8;border-radius:16px">
<tr><td style="padding:28px 28px 8px"><p style="margin:0;font-size:13px;color:#6b6275">Lufer</p>
<h1 style="margin:8px 0 0;font-size:22px;line-height:1.3">${esc(b.venueName)} accepted your event request</h1></td></tr>
<tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.5"><p style="margin:0 0 12px">${esc(greeting)}</p><p style="margin:0">${esc(intro)}</p></td></tr>
<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
${rows.map(([k, v], i) => `<tr><td style="padding:6px 0;color:#6b6275${i === rows.length - 1 ? ";border-top:1px solid #ece4d8;padding-top:10px;color:#2a1b3d;font-weight:600" : ""}">${esc(k)}</td><td align="right" style="padding:6px 0${i === rows.length - 1 ? ";border-top:1px solid #ece4d8;padding-top:10px;font-weight:600" : ""}">${esc(v)}</td></tr>`).join("\n")}
</table></td></tr>
<tr><td style="padding:24px 28px"><a href="${esc(b.bookingUrl)}" style="display:inline-block;background:#ff6b4a;color:#1a1523;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9999px">View booking voucher</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;color:#6b6275">GST is invoiced under SAC 998596 and claimable as input tax credit.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
