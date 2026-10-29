import type { Metadata } from "next";
import Link from "next/link";

import { Detail, LegalPage } from "@/components/legal/legal-page";
import { entityName, LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for companies, venues and partners using the Lufer corporate events marketplace.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const us = entityName();
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These terms are an agreement between you and {us} (&ldquo;{LEGAL.brand}&rdquo;, &ldquo;we&rdquo;) for the use of lufer.app, our apps and related
          services (the &ldquo;Service&rdquo;). If you accept them for a company, you confirm you&apos;re authorised to bind it. Please also read our{" "}
          <Link href="/privacy">Privacy Policy</Link> and <Link href="/refunds">Cancellation &amp; Refund Policy</Link>.
        </p>
      }
    >
      <h2>1. The Service</h2>
      <p>
        {LEGAL.brand} is an online marketplace. Companies (&ldquo;Buyers&rdquo;) use it to find, request, approve and pay for corporate events, dining and
        experiences. Venues and other suppliers (&ldquo;Partners&rdquo;) use it to receive requests, send quotes and get paid.
      </p>
      <p>
        Unless a booking says otherwise, the Partner supplies the event and is responsible for delivering it, for its premises, food, safety and licences, and
        for the accuracy of its listing. We provide the platform, collect payments as an e-commerce operator and pass them on to the Partner after deducting
        our commission and applicable taxes.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>Accounts are for businesses. We review every application and may decline or close an account at our discretion.</li>
        <li>Keep your sign-in secure. You&apos;re responsible for activity under your account and for the users your company adds.</li>
        <li>Information you give us, including GSTINs, must be accurate and kept up to date.</li>
      </ul>

      <h2>3. Requests, quotes and bookings</h2>
      <ul>
        <li>A quote is an offer from the Partner on the terms shown, including price, inclusions and cancellation terms.</li>
        <li>A booking is confirmed when the Buyer accepts a quote, any required approvals are given, the Partner accepts and any deposit is paid.</li>
        <li>Changes to headcount, dates or menus after confirmation depend on the Partner&apos;s agreement and may change the price.</li>
        <li>AI features help you search, draft and compare. Check their suggestions; the quote and booking confirmation are what bind you.</li>
      </ul>

      <h2>4. Prices, taxes and payment</h2>
      <ul>
        <li>Prices are in Indian rupees. GST is shown separately and charged at the applicable rate; tax invoices are issued for each booking.</li>
        <li>Payments are processed by Razorpay. A deposit may be required to confirm a booking, with the balance due as stated in the booking.</li>
        <li>Partners receive the booking value less our commission, GST on that commission and TCS under Section 52 of the CGST Act, on the payout schedule shown in their account.</li>
        <li>Late or failed payments may lead to cancellation of the booking.</li>
      </ul>

      <h2>5. Cancellations and refunds</h2>
      <p>
        Cancellations and refunds follow the Partner&apos;s cancellation terms shown on the quote and our{" "}
        <Link href="/refunds">Cancellation &amp; Refund Policy</Link>.
      </p>

      <h2>6. Your responsibilities</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service unlawfully, or to arrange events that break the law or a venue&apos;s rules;</li>
        <li>arrange bookings with a Partner you met through {LEGAL.brand} off the platform to avoid our fees, for 12 months after you were introduced;</li>
        <li>upload content you don&apos;t have the right to share, or personal data you aren&apos;t allowed to give us;</li>
        <li>interfere with the Service, probe it for vulnerabilities without permission, or access it by automated means other than our published integrations.</li>
      </ul>
      <p>
        Buyers who add guests, employees or other people to the Service confirm they have a lawful basis to share their details with us for the event.
      </p>

      <h2>7. Content and intellectual property</h2>
      <p>
        You keep ownership of content you upload, and give us a licence to use it to run and improve the Service. Partners also allow us to display their
        listings, photos and menus on the Service. We own the Service, its software and our brand.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo;. We work to keep it available and accurate but don&apos;t guarantee it will be uninterrupted or error-free.
        We are not responsible for the acts or omissions of Partners or Buyers, or for the quality of events supplied by Partners, though we will help resolve
        disputes raised through the platform.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential losses, or for lost profits, revenue or data. Our total liability for
        any claim relating to the Service is limited to the fees we earned from you for the booking concerned, or ₹10,000 if the claim doesn&apos;t relate to a
        booking. Nothing in these terms limits liability that can&apos;t be limited by law.
      </p>

      <h2>10. Indemnity</h2>
      <p>
        You will compensate us for third-party claims arising from your breach of these terms or of the law, or, for Partners, from the events you supply.
      </p>

      <h2>11. Suspension and termination</h2>
      <p>
        You can close your account at any time. We may suspend or close accounts that breach these terms or put other users at risk. Bookings confirmed
        before closure, payment obligations and sections 7 to 13 survive.
      </p>

      <h2>12. Changes</h2>
      <p>
        We may update these terms. We&apos;ll post changes here and notify account holders of material changes by email before they take effect. Continuing to
        use the Service after that means you accept them.
      </p>

      <h2>13. Law and disputes</h2>
      <p>
        These terms are governed by the laws of India. Courts in {LEGAL.jurisdictionCity} have exclusive jurisdiction. Before going to court, please contact
        us so we can try to resolve the dispute.
      </p>

      <h2>14. Contact</h2>
      <p>
        {us}, <Detail value={LEGAL.registeredAddress} label="Registered address" />. Email <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>.
        Grievances: <a href={`mailto:${LEGAL.grievanceOfficer.email}`}>{LEGAL.grievanceOfficer.email}</a>.
      </p>
    </LegalPage>
  );
}
