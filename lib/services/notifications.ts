import "server-only";

import { dataSource, listBookings, listCompanies } from "@/lib/data";
import { bookingAcceptedMessage } from "@/lib/notifications/booking-accepted";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Customer notifications. Email goes through Resend's HTTP API when
 * RESEND_API_KEY and NOTIFY_FROM_EMAIL are set. Without them nothing is sent
 * and nothing throws: in development and tests the whole message is logged
 * (to check it without a provider); in production only that it was skipped,
 * since the message carries the customer's address and booking details.
 */

export type NotifyOutcome = { status: "sent"; to: string } | { status: "skipped"; reason: string } | { status: "failed"; error: string };

type Attachment = { filename: string; content: string; contentType: string };

async function sendEmail(message: { to: string; subject: string; text: string; html: string; replyTo?: string; attachments?: Attachment[] }): Promise<NotifyOutcome> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  if (!key || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`notify: [email not sent: no provider configured]\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
    }
    return { status: "skipped", reason: "No email provider configured (RESEND_API_KEY, NOTIFY_FROM_EMAIL)." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.replyTo && { reply_to: message.replyTo }),
        // Resend takes attachment content base64-encoded.
        ...(message.attachments?.length && {
          attachments: message.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "utf8").toString("base64"), content_type: a.contentType })),
        }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: "failed", error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { status: "sent", to: message.to };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** The requester (bookings.requested_by), else the company's primary contact. */
async function recipientFor(booking: { requested_by?: string | null; company_id: string }): Promise<{ email: string; name: string | null } | null> {
  if (booking.requested_by && dataSource() === "supabase") {
    const { data } = await createAdminClient().auth.admin.getUserById(booking.requested_by);
    const u = data?.user;
    if (u?.email) return { email: u.email, name: typeof u.user_metadata?.name === "string" ? u.user_metadata.name : null };
  }
  const company = (await listCompanies()).find((c) => c.id === booking.company_id);
  return company?.primary_contact_email ? { email: company.primary_contact_email, name: null } : null;
}

/**
 * Tells the customer their venue accepted: the summary, the locked price and
 * GST, and a link to the booking. Never throws.
 */
export async function notifyVenueAccepted(bookingId: string, venueId: string): Promise<NotifyOutcome> {
  try {
    const booking = (await listBookings({ venueId })).find((b) => b.id === bookingId);
    if (!booking) return { status: "skipped", reason: "Booking not found." };
    const to = await recipientFor(booking);
    if (!to) return { status: "skipped", reason: "No address for the requester or the company." };
    const message = bookingAcceptedMessage({
      bookingId: booking.id,
      venueName: booking.venue.name,
      venueArea: `${booking.venue.neighborhood}, ${booking.venue.city}`,
      eventDate: booking.event_date,
      partySize: booking.party_size,
      perHead: Number(booking.budget_per_head_inr),
      companyName: booking.company.legal_name,
      invoice: booking.invoice,
      bookingUrl: new URL(`/client/events/${booking.id}`, siteUrl("http://localhost:3000")).toString(),
      recipientName: to.name,
    });
    const outcome = await sendEmail({ to: to.email, ...message });
    if (outcome.status !== "sent") console.warn(`notify: venue-accepted email for ${bookingId} ${outcome.status}:`, "reason" in outcome ? outcome.reason : outcome.error);
    return outcome;
  } catch (err) {
    console.error("notify: venue-accepted failed", err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Tells an applicant their account was approved (with the link to sign in)
 * or not (with the reason, if the admin gave one). Never throws.
 */
export async function notifyApplicationDecision(app: { email: string; full_name: string; account_type: string; status: string; rejection_reason: string | null }): Promise<NotifyOutcome> {
  try {
    const first = app.full_name.split(" ")[0];
    const signIn = new URL("/login", siteUrl("http://localhost:3000")).toString();
    const portal = app.account_type === "partner" ? "partner portal" : app.account_type === "venue" ? "venue portal" : "company portal";
    const approved = app.status === "active";
    const subject = approved ? "Your Lufer account is approved" : "Your Lufer application";
    const lines = approved
      ? [`Hi ${first},`, "", `Your account is approved. Sign in to open your ${portal}:`, signIn, "", "— Lufer"]
      : [
          `Hi ${first},`,
          "",
          "Thanks for applying. We couldn't approve your account this time.",
          ...(app.rejection_reason ? ["", `Reason: ${app.rejection_reason}`] : []),
          "",
          "If you think this is a mistake, reply to this email.",
          "— Lufer",
        ];
    const text = lines.join("\n");
    const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1A1714;line-height:1.5">${lines
      .map((l) => (l === signIn ? `<p><a href="${escHtml(signIn)}">Sign in to Lufer</a></p>` : l ? `<p style="margin:0">${escHtml(l)}</p>` : "<br>"))
      .join("")}</body></html>`;
    return await sendEmail({ to: app.email, subject, text, html });
  } catch (err) {
    console.error("notify: application decision failed", err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Emails a company's monthly statement summary to its primary contact, with a
 * link to the full statement in the portal. Never throws.
 */
export async function notifyMonthlyStatement(s: {
  number: string;
  label: string;
  month: string;
  companyId: string;
  bookingCount: number;
  vendorCount: number;
  total: number;
  due: number;
}): Promise<NotifyOutcome> {
  try {
    const company = (await listCompanies()).find((c) => c.id === s.companyId);
    if (!company?.primary_contact_email) return { status: "skipped", reason: "No primary contact for the company." };
    const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
    const url = new URL(`/client/statements?month=${s.month}`, siteUrl("http://localhost:3000")).toString();
    const summary = `${s.bookingCount} booking${s.bookingCount === 1 ? "" : "s"} across ${s.vendorCount} vendor${s.vendorCount === 1 ? "" : "s"}. Total ${inr.format(s.total)} including GST; balance due ${inr.format(s.due)}.`;
    const subject = `Your Lufer statement for ${s.label} (${s.number})`;
    const text = `Your statement for ${s.label} is ready.\n\n${summary}\n\nView, print or download the CSV: ${url}\n\nEach line references the vendor's own GST tax invoice, which is what you claim input tax credit against.`;
    const html = `<p>Your statement for <strong>${escHtml(s.label)}</strong> is ready.</p><p>${escHtml(summary)}</p><p><a href="${escHtml(url)}">View, print or download the CSV</a></p><p style="color:#5E564C;font-size:12px">Each line references the vendor's own GST tax invoice, which is what you claim input tax credit against.</p>`;
    const outcome = await sendEmail({ to: company.primary_contact_email, subject, text, html });
    if (outcome.status !== "sent") console.warn(`notify: statement email for ${s.number} ${outcome.status}:`, "reason" in outcome ? outcome.reason : outcome.error);
    return outcome;
  } catch (err) {
    console.error("notify: monthly statement failed", err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Tells someone an Approver added them to their company, with where to sign in. Never throws. */
export async function notifyTeamInvite(to: string, message: { subject: string; text: string; lines: string[] }, signInUrl: string): Promise<NotifyOutcome> {
  try {
    const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1A1714;line-height:1.5">${message.lines
      .map((l) => (l === signInUrl ? `<p><a href="${escHtml(signInUrl)}">Sign in to Lufer</a></p>` : l ? `<p style="margin:0">${escHtml(l)}</p>` : "<br>"))
      .join("")}</body></html>`;
    return await sendEmail({ to, subject: message.subject, text: message.text, html });
  } catch (err) {
    console.error("notify: team invite failed", err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

const plainHtml = (lines: string[]) =>
  `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1A1714;line-height:1.5">${lines
    .map((l) => (l ? `<p style="margin:0">${escHtml(l)}</p>` : "<br>"))
    .join("")}</body></html>`;

/**
 * Concierge request (lib/concierge/request.ts): to Lufer ops at
 * CONCIERGE_EMAIL, reply-to the requester, plus a receipt to the requester.
 * Returns whether ops got it: without that the request would be lost, so
 * callers report failure instead of a receipt.
 */
export async function notifyConciergeRequest(
  ops: { subject: string; lines: string[] },
  requester: { email: string; subject: string; lines: string[] }
): Promise<{ delivered: boolean; reason?: string }> {
  const to = process.env.CONCIERGE_EMAIL?.trim();
  if (!to) return { delivered: false, reason: "CONCIERGE_EMAIL is not set." };
  const sent = await sendEmail({ to, subject: ops.subject, text: ops.lines.join("\n"), html: plainHtml(ops.lines), replyTo: requester.email });
  if (sent.status !== "sent") return { delivered: false, reason: "reason" in sent ? sent.reason : sent.error };
  const receipt = await sendEmail({ to: requester.email, subject: requester.subject, text: requester.lines.join("\n"), html: plainHtml(requester.lines) });
  if (receipt.status !== "sent") console.warn("notify: concierge receipt not sent", "reason" in receipt ? receipt.reason : receipt.error);
  return { delivered: true };
}

/**
 * The tax invoice, issued after the event: to the requester and the company's
 * primary contact, with the invoice attached (print-ready HTML; open it and
 * Save as PDF) and a link to the event. Never throws.
 */
export async function notifyInvoiceIssued(
  booking: { id: string; company_id: string; requested_by?: string | null; event_date: string; venue: { name: string }; company: { legal_name: string }; invoice: { invoice_total: number } },
  doc: { invoiceNumber: string; html: string }
): Promise<NotifyOutcome> {
  try {
    const requester = await recipientFor(booking);
    const company = (await listCompanies()).find((c) => c.id === booking.company_id);
    const to = [...new Set([requester?.email, company?.primary_contact_email].filter((e): e is string => Boolean(e)))];
    if (!to.length) return { status: "skipped", reason: "No email for the company." };
    const link = new URL(`/client/events/${booking.id}`, siteUrl("https://lufer.app")).toString();
    const lines = [
      `Tax invoice ${doc.invoiceNumber} for your event at ${booking.venue.name} on ${booking.event_date} is attached.`,
      "",
      `Invoice total: ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(booking.invoice.invoice_total)}`,
      `It's also on the event in Lufer: ${link}`,
      "",
      "Open the attachment in a browser and choose Print → Save as PDF for your records.",
    ];
    const filename = `${doc.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-")}.html`;
    let last: NotifyOutcome = { status: "skipped", reason: "No recipient." };
    for (const address of to) {
      last = await sendEmail({
        to: address,
        subject: `Tax invoice ${doc.invoiceNumber} · ${booking.venue.name}, ${booking.event_date}`,
        text: lines.join("\n"),
        html: plainHtml(lines),
        attachments: [{ filename, content: doc.html, contentType: "text/html" }],
      });
      if (last.status !== "sent") return last;
    }
    return last;
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** A message to Lufer ops (CONCIERGE_EMAIL), reply-to whoever it's about. Never throws. */
export async function notifyOps(message: { subject: string; lines: string[] }, replyTo?: string): Promise<NotifyOutcome> {
  const to = process.env.CONCIERGE_EMAIL?.trim();
  if (!to) return { status: "skipped", reason: "CONCIERGE_EMAIL is not set." };
  try {
    return await sendEmail({ to, subject: message.subject, text: message.lines.join("\n"), html: plainHtml(message.lines), ...(replyTo && { replyTo }) });
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** A venue alert (lib/venues/alerts.ts). Never throws. */
export async function sendVenueAlert(to: string, message: { subject: string; lines: string[] }): Promise<NotifyOutcome> {
  try {
    return await sendEmail({ to, subject: message.subject, text: message.lines.join("\n"), html: plainHtml(message.lines) });
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
