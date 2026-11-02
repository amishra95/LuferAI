import type { Metadata } from "next";
import Link from "next/link";

import { Detail, LegalPage, TableScroll } from "@/components/legal/legal-page";
import { entityName, LEGAL, PROCESSORS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Lufer collects, uses and protects personal data under India's Digital Personal Data Protection Act, 2023.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const us = entityName();
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          {us} (&ldquo;{LEGAL.brand}&rdquo;, &ldquo;we&rdquo;) runs a marketplace where companies book corporate events and hospitality, and venues and partners
          supply them. This policy explains what personal data we process, why, and the rights you have under India&apos;s Digital Personal Data Protection
          Act, 2023 (&ldquo;DPDP Act&rdquo;) and the Information Technology Act, 2000.
        </p>
      }
    >
      <h2>1. Who is responsible</h2>
      <p>
        {us} is the Data Fiduciary for personal data processed through lufer.app and our apps. Registered office: <Detail value={LEGAL.registeredAddress} label="Registered address" />.
        Questions about this policy: <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
      </p>
      <p>
        When a company uses {LEGAL.brand} to manage its own employees&apos; or guests&apos; data (for example a guest list), that company decides why the data
        is collected and we process it on its instructions.
      </p>

      <h2>2. What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> name, work email, phone number, company or venue name, role, and your application to join.
        </li>
        <li>
          <strong>Business details:</strong> GSTIN, billing address, cost centres, budgets, purchase orders and approval settings.
        </li>
        <li>
          <strong>Event details:</strong> event requests, dates, headcounts, dietary and accessibility notes you enter, quotes, contracts and bookings.
        </li>
        <li>
          <strong>Guest data:</strong> names and email addresses of invitees added by an organiser, and their RSVP replies.
        </li>
        <li>
          <strong>Payment data:</strong> payment status, amounts and references. Card, UPI and bank details are entered with Razorpay and are never stored by us.
        </li>
        <li>
          <strong>Messages:</strong> chats with our AI concierge and messages sent through WhatsApp, Slack or email integrations you connect.
        </li>
        <li>
          <strong>Technical data:</strong> sign-in sessions, device and browser type, pages visited (in aggregate, without advertising cookies) and error reports.
        </li>
      </ul>

      <h2>3. Why we use it</h2>
      <ul>
        <li>To run the service: sourcing venues, sending requests and quotes, routing approvals, confirming bookings and collecting RSVPs.</li>
        <li>To take payments, issue GST-compliant tax invoices, pay out venues and partners, and keep the tax records the law requires (including TCS under Section 52 of the CGST Act).</li>
        <li>To keep accounts secure, prevent fraud and abuse, and fix errors.</li>
        <li>To provide AI features, which send the text needed for a request (never payment details) to the AI providers listed below so they can return a response.</li>
        <li>To contact you about your bookings and account. We send marketing only with your consent, and you can opt out at any time.</li>
      </ul>
      <p>
        We process personal data on the basis of your consent, given when you sign up or submit information, and for the legitimate uses the DPDP Act allows,
        such as complying with law, responding to legal orders and acting on information you have voluntarily provided for a purpose.
      </p>

      <h2>4. Who we share it with</h2>
      <p>
        We share booking details with the venue or partner you book, and with people in your company who need them to approve or pay (for example finance
        approvers). Venues never see your guest list. We do not sell personal data.
      </p>
      <p>We use these service providers, who process data only on our instructions:</p>
      <TableScroll>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Purpose</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.purpose}</td>
                <td>{p.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p>
        Some of these providers process data outside India. We transfer data only to countries not restricted by the Government of India under Section 16 of
        the DPDP Act. We may also disclose data when the law requires it.
      </p>

      <h2>5. How long we keep it</h2>
      <ul>
        <li>Account, booking and guest data: for as long as your account is active, or until you or your company ask us to delete it.</li>
        <li>Tax invoices, payment and TCS records: for at least 72 months, as required by Section 36 of the CGST Act, even after an account is closed.</li>
        <li>Error and security logs: for a limited period, then deleted.</li>
      </ul>

      <h2>6. Your rights</h2>
      <p>Under the DPDP Act you can:</p>
      <ul>
        <li>ask for a summary of the personal data we hold about you and how it is processed;</li>
        <li>ask us to correct, complete, update or erase it;</li>
        <li>withdraw consent at any time (this doesn&apos;t affect processing already done, and we may need to keep some records by law);</li>
        <li>nominate someone to exercise these rights if you die or become incapacitated;</li>
        <li>have your grievances addressed by our Grievance Officer.</li>
      </ul>
      <p>
        Email <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a> from the address on your account. We respond within 30 days. If your company
        manages your data (for example as an invited guest), we may pass your request to them.
      </p>

      <h2>7. Grievance Officer</h2>
      <p>
        <Detail value={LEGAL.grievanceOfficer.name} label="Grievance Officer name" />
        <br />
        <a href={`mailto:${LEGAL.grievanceOfficer.email}`}>{LEGAL.grievanceOfficer.email}</a>
        <br />
        <Detail value={LEGAL.registeredAddress} label="Registered address" />
      </p>
      <p>
        We acknowledge grievances within 24 hours and resolve them within 15 days. If you&apos;re not satisfied with our response, you can complain to the Data
        Protection Board of India.
      </p>

      <h2>8. Security</h2>
      <p>
        Data is encrypted in transit and at rest. Access is restricted by role and company, so one company cannot see another&apos;s data. We will notify you and the Data Protection Board of a personal data breach as the DPDP Act requires.
      </p>

      <h2>9. Cookies</h2>
      <p>
        We use only the cookies needed to keep you signed in and secure. Our usage analytics do not use cookies or track you across sites, and we do not use
        advertising cookies.
      </p>

      <h2>10. Children</h2>
      <p>{LEGAL.brand} is a business service for adults. We do not knowingly collect data from anyone under 18.</p>

      <h2>11. Changes</h2>
      <p>
        We&apos;ll post changes here and update the date above. For material changes we&apos;ll notify account holders by email before they take effect. See also
        our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
