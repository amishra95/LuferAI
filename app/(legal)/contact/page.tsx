import type { Metadata } from "next";

import { Detail, LegalPage } from "@/components/legal/legal-page";
import { entityName, LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Contact us",
  description: "How to reach Lufer.ai for support, privacy requests and grievances.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <LegalPage title="Contact us">
      <h2>Support</h2>
      <p>
        Bookings, payments, refunds and account help: <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>. We reply within one working day,
        Monday to Friday.
      </p>

      <h2>Privacy requests</h2>
      <p>
        To access, correct or delete your personal data: <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
      </p>

      <h2>Grievance Officer</h2>
      <p>
        <Detail value={LEGAL.grievanceOfficer.name} label="Grievance Officer name" />
        <br />
        <a href={`mailto:${LEGAL.grievanceOfficer.email}`}>{LEGAL.grievanceOfficer.email}</a>
      </p>

      <h2>Registered office</h2>
      <p>
        {entityName()}
        <br />
        <Detail value={LEGAL.registeredAddress} label="Registered address" />
        {LEGAL.cin ? (
          <>
            <br />
            CIN: {LEGAL.cin}
          </>
        ) : null}
      </p>
    </LegalPage>
  );
}
