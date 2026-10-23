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

async function sendEmail(message: { to: string; subject: string; text: string; html: string }): Promise<NotifyOutcome> {
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
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
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
    const portal = app.account_type === "partner" ? "partner portal" : "company portal";
    const approved = app.status === "active";
    const subject = approved ? "Your Lufer.ai account is approved" : "Your Lufer.ai application";
    const lines = approved
      ? [`Hi ${first},`, "", `Your account is approved. Sign in to open your ${portal}:`, signIn, "", "— Lufer.ai"]
      : [
          `Hi ${first},`,
          "",
          "Thanks for applying. We couldn't approve your account this time.",
          ...(app.rejection_reason ? ["", `Reason: ${app.rejection_reason}`] : []),
          "",
          "If you think this is a mistake, reply to this email.",
          "— Lufer.ai",
        ];
    const text = lines.join("\n");
    const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#2a1b3d;line-height:1.5">${lines
      .map((l) => (l === signIn ? `<p><a href="${escHtml(signIn)}">Sign in to Lufer.ai</a></p>` : l ? `<p style="margin:0">${escHtml(l)}</p>` : "<br>"))
      .join("")}</body></html>`;
    return await sendEmail({ to: app.email, subject, text, html });
  } catch (err) {
    console.error("notify: application decision failed", err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
