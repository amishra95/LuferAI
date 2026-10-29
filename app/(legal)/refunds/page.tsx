import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Cancellation & Refund Policy",
  description: "How cancellations, deposits and refunds work for bookings and orders on Lufer.",
  alternates: { canonical: "/refunds" },
};

export default function RefundsPage() {
  return (
    <LegalPage
      title="Cancellation & Refund Policy"
      intro={
        <p>
          This policy explains what happens to your money when a booking or catalogue order is cancelled. It forms part of our{" "}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      }
    >
      <h2>1. Venue bookings</h2>
      <h3>Each venue sets its cancellation terms</h3>
      <p>
        Every quote shows the venue&apos;s cancellation terms before you accept it: how many days&apos; notice earns what share of a refund. More notice never
        earns a smaller refund. The terms on the quote you accepted apply to that booking.
      </p>
      <h3>Before confirmation</h3>
      <p>
        If a request is declined by the venue, rejected by your approvers or withdrawn before the venue confirms it, any payment authorised for it is released
        in full. Your bank or UPI app returns held amounts automatically, usually within 5 working days.
      </p>
      <h3>After confirmation</h3>
      <ul>
        <li>
          <strong>You cancel:</strong> you get back the share set by the venue&apos;s terms for the notice you gave. To cancel, email{" "}
          <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a> with your booking reference; the time we receive your email is the time used.
        </li>
        <li>
          <strong>The venue cancels or can&apos;t deliver:</strong> you get a full refund of everything paid for the booking, and we&apos;ll help you find an
          alternative.
        </li>
        <li>
          <strong>Changes:</strong> reducing headcount or changing dates after confirmation is a partial cancellation and follows the same terms, unless the venue
          agrees otherwise in writing.
        </li>
      </ul>

      <h2>2. Catalogue orders</h2>
      <ul>
        <li>Orders cancelled before the partner confirms them are released in full.</li>
        <li>Orders cancelled after confirmation but before dispatch are refunded in full, less any cost the partner has already incurred and shows us.</li>
        <li>Items that arrive damaged, wrong or not at all are refunded or replaced if you report them within 48 hours of the delivery date.</li>
        <li>Personalised or perishable items can&apos;t be returned unless they are faulty.</li>
      </ul>

      <h2>3. Events that can&apos;t go ahead</h2>
      <p>
        If an event can&apos;t take place because of circumstances beyond anyone&apos;s control, such as a government order or natural disaster, we&apos;ll work
        with the venue to reschedule first. If that isn&apos;t possible, refunds follow the venue&apos;s terms for force majeure, or a refund of amounts not yet
        spent by the venue if its terms are silent.
      </p>

      <h2>4. How refunds are paid</h2>
      <ul>
        <li>Refunds go back to the original payment method through Razorpay.</li>
        <li>We start approved refunds within 2 working days. Banks usually credit them within 5 to 7 working days after that.</li>
        <li>GST charged on a refunded amount is refunded with it, with the GST documents the law requires.</li>
        <li>Our service fee is refunded whenever the refund is due to the venue or partner cancelling, or to our error.</li>
      </ul>

      <h2>5. Disputes</h2>
      <p>
        If you disagree with a cancellation charge, email <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a> within 30 days of the event date
        with your booking reference. We&apos;ll review it with the venue and reply within 15 days.
      </p>
    </LegalPage>
  );
}
