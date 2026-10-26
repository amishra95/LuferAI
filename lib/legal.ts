/**
 * Business details shown on the legal pages (app/(legal)/*). One place to update them.
 *
 * Values marked PENDING must be filled in before launch: the registered legal entity,
 * its address and the Grievance Officer are required by the DPDP Act 2023 and by
 * Razorpay's website review. Until then the pages show a visible "to be confirmed" note
 * instead of inventing details. Have counsel review the policy text before going live.
 */

export const PENDING = null;

export const LEGAL = {
  brand: "Lufer.ai",
  /** Registered company name, e.g. "Lufer Technologies Private Limited". */
  legalEntity: PENDING as string | null,
  /** Registered office address. */
  registeredAddress: PENDING as string | null,
  /** CIN, if incorporated. */
  cin: PENDING as string | null,
  supportEmail: "support@lufer.ai",
  privacyEmail: "privacy@lufer.ai",
  /** Grievance Officer under the DPDP Act 2023 and the IT Rules 2021. */
  grievanceOfficer: { name: PENDING as string | null, email: "grievance@lufer.ai" },
  /** Courts with jurisdiction under the Terms. */
  jurisdictionCity: "Bengaluru",
  lastUpdated: "26 October 2026",
} as const;

/** The entity name for sentences: the legal name once known, the brand until then. */
export function entityName(): string {
  return LEGAL.legalEntity ?? LEGAL.brand;
}

/** Services that process personal data on our behalf, for the Privacy Policy. */
export const PROCESSORS: { name: string; purpose: string; location: string }[] = [
  { name: "Supabase", purpose: "Database, sign-in and file storage", location: "India (Mumbai, AWS ap-south-1)" },
  { name: "Vercel", purpose: "Website and application hosting, privacy-friendly usage analytics", location: "Global edge network; functions in the United States" },
  { name: "Upstash", purpose: "Caching, rate limiting and operational metrics", location: "Cloud regions as configured" },
  { name: "Razorpay", purpose: "Payments, refunds and payouts to venues and partners", location: "India" },
  { name: "Google (Gemini), OpenAI, Anthropic, Groq", purpose: "AI features: venue sourcing, quote drafting, the concierge, invoice reading", location: "United States and other regions" },
  { name: "Meta (WhatsApp Business), Twilio, Slack", purpose: "Approval requests and notifications you choose to receive", location: "United States and other regions" },
  { name: "MapTiler", purpose: "Maps on venue pages", location: "European Union" },
  { name: "Sentry", purpose: "Error monitoring, with cookies, IP addresses and private link tokens removed", location: "United States" },
];
