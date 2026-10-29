/**
 * The /signup form: validation shared by the server action (on submit) and
 * /auth/callback (which creates the application from what was submitted,
 * carried in the new user's metadata). Pure: tests/auth/admin-approval.test.mjs
 * imports it directly.
 */
import { validateGstin } from "../gst-engine.ts";
import { normalizePhone } from "../phone.ts";
import type { AccountType } from "./onboarding.ts";

export const PARTNER_KINDS = ["entertainment", "experiences", "catering", "decor", "av_production", "gifting", "other"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  entertainment: "Entertainment (artists, DJs, bands)",
  experiences: "Experiences & team activities",
  catering: "Catering",
  decor: "Décor & styling",
  av_production: "AV & production",
  gifting: "Gifting & merchandise",
  other: "Something else",
};

export interface SignupInput {
  account_type: AccountType;
  email: string;
  full_name: string;
  company_name: string;
  phone: string | null;
  job_title: string | null;
  city: string | null;
  message: string | null;
  /** Enterprise: required (its invoices are raised on it). Partner: optional. */
  gstin: string | null;
  /** Partner: their website, portfolio or showreel. */
  venue_website: string | null;
  /** Partner: what they offer. */
  partner_role: PartnerKind | null;
}

export type SignupField = Exclude<keyof SignupInput, "account_type">;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const optional = (v: unknown, max: number) => text(v).slice(0, max) || null;

/** "lufer.app/acts" → "https://lufer.app/acts"; null when it isn't an http(s) URL with a host. */
export function normalizeWebsite(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export function parseSignupInput(raw: Record<string, unknown>): { ok: true; value: SignupInput } | { ok: false; errors: Partial<Record<SignupField | "account_type", string>> } {
  const errors: Partial<Record<SignupField | "account_type", string>> = {};
  const accountType = raw.account_type === "enterprise" || raw.account_type === "partner" ? raw.account_type : null;
  if (!accountType) errors.account_type = "Choose enterprise or partner.";

  const email = text(raw.email).toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) errors.email = "Enter a valid work email.";
  const fullName = text(raw.full_name);
  if (fullName.length < 2 || fullName.length > 120) errors.full_name = "Enter your full name.";
  const company = text(raw.company_name);
  if (company.length < 2 || company.length > 120) errors.company_name = accountType === "partner" ? "Enter your business or stage name." : "Enter your company's legal name.";

  const phoneRaw = text(raw.phone);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) errors.phone = "Enter a mobile number, e.g. +91 98450 12345.";

  const gstinRaw = text(raw.gstin).replace(/\s/g, "").toUpperCase();
  let gstin: string | null = null;
  if (gstinRaw) {
    const check = validateGstin(gstinRaw);
    if (check.valid) gstin = gstinRaw;
    else errors.gstin = "That GSTIN isn't valid. Check the 15 characters.";
  } else if (accountType === "enterprise") {
    errors.gstin = "Enter your company's GSTIN: invoices are raised on it.";
  }

  let website: string | null = null;
  let kind: PartnerKind | null = null;
  if (accountType === "partner") {
    website = normalizeWebsite(text(raw.venue_website));
    if (!website) errors.venue_website = "Add your website, portfolio or showreel link.";
    kind = (PARTNER_KINDS as readonly string[]).includes(String(raw.partner_role)) ? (raw.partner_role as PartnerKind) : null;
    if (!kind) errors.partner_role = "Choose what you offer.";
  }

  const message = optional(raw.message, 1000);
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      account_type: accountType!,
      email,
      full_name: fullName,
      company_name: company,
      phone: phone || null,
      job_title: optional(raw.job_title, 120),
      city: optional(raw.city, 80),
      message,
      gstin,
      venue_website: website,
      partner_role: kind,
    },
  };
}
