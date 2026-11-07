/**
 * Emails that tell a venue a company wants it: a booking request (the date is
 * held for them, so the deadline matters) and an RFP (an instant quote went
 * out in their name; they can adjust it without logging in). Pure: tests
 * import it; lib/venues/alerts.ts sends them.
 */

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const clock = (d: Date) => d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export interface AlertMessage {
  subject: string;
  lines: string[];
}

/** For a request sent to a Lufer-concierge inbox instead of the venue (no manager yet). */
const forConcierge = (venueName: string) => [`No manager is set up for ${venueName}, so this came to the Lufer concierge. Call the venue to confirm.`, ""];

export function bookingRequestAlert(
  b: {
    venueName: string;
    companyName: string;
    eventDate: string;
    guests: number;
    perHead: number;
    taxable: number;
    payout: number;
    notes: string | null;
    holdExpiresAt: Date;
  },
  link: string,
  concierge = false
): AlertMessage {
  const company = b.companyName.replace(/ Private Limited$/i, "");
  return {
    subject: `New request: ${company}, ${b.guests} guests, ${longDate(b.eventDate)}`,
    lines: [
      ...(concierge ? forConcierge(b.venueName) : []),
      `${company} wants ${b.venueName} for ${b.guests} guests on ${longDate(b.eventDate)}.`,
      "",
      `Price: ${inr(b.perHead)} a head, ${inr(b.taxable)} before GST`,
      `You receive: ${inr(b.payout)}`,
      ...(b.notes ? [`Notes: ${b.notes}`] : []),
      "",
      `The date is held for you until ${clock(b.holdExpiresAt)}. Accept or decline before then:`,
      link,
      "",
      "— Lufer",
    ],
  };
}

export function rfpAlert(
  r: { venueName: string; companyName: string; guests: number; eventDate: string | null; perHead: number | null },
  link: string,
  concierge = false
): AlertMessage {
  const company = r.companyName.replace(/ Private Limited$/i, "");
  const when = r.eventDate ? ` on ${longDate(r.eventDate)}` : "";
  return {
    subject: `Quote request: ${company}, ${r.guests} guests${when}`,
    lines: [
      ...(concierge ? forConcierge(r.venueName) : []),
      `${company} is comparing venues for ${r.guests} guests${when}, and ${r.venueName} is on their list.`,
      "",
      r.perHead != null ? `We sent them your standard price of ${inr(r.perHead)} a head.` : "They're waiting for your price.",
      "Adjust your price and what's included, or decline (no login needed):",
      link,
      "",
      "— Lufer",
    ],
  };
}
