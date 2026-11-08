"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { AccountType } from "@/lib/auth/onboarding";
import { PARTNER_KIND_LABEL, PARTNER_KINDS, type SignupField } from "@/lib/auth/signup-input";
import { submitSignup, type SignupState } from "../actions";

/** Required fields get an asterisk; optional ones are left unmarked. */
function Field({ id, label, required, error, children }: { id: SignupField; label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden className="text-destructive -ml-1.5">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-caption">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const COMPANY_LABEL: Record<AccountType, string> = { enterprise: "Company (legal name)", venue: "Venue name", partner: "Business or stage name" };

/**
 * One form for every account type, in the order name, email, mobile, website,
 * then the business: a venue also gives where it is and how many it seats; a
 * partner, what they offer. Only what an
 * account needs to open; the rest (role, notes) belongs in settings later.
 */
export function SignupForm({ accountType }: { accountType: AccountType }) {
  const [state, action, pending] = useActionState<SignupState, FormData>(submitSignup, { status: "idle" });
  const e = state.fieldErrors ?? {};
  const invalid = (f: SignupField) => ({ "aria-invalid": Boolean(e[f]) || undefined, "aria-describedby": e[f] ? `${f}-error` : undefined });

  if (state.status === "sent") {
    return (
      <p role="status" className="flex items-start gap-2 text-body">
        <CheckCircle2 className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        {state.message}
      </p>
    );
  }

  // Venues and partners may give it now; a company adds it before its first booking.
  const gstinField = (
    <Field id="gstin" label="GSTIN" error={e.gstin}>
      <Input id="gstin" name="gstin" maxLength={15} autoCapitalize="characters" className="font-mono uppercase" {...invalid("gstin")} />
    </Field>
  );
  const companyField = (
    <Field id="company_name" label={COMPANY_LABEL[accountType]} required error={e.company_name}>
      <Input id="company_name" name="company_name" autoComplete="organization" required maxLength={120} {...invalid("company_name")} />
    </Field>
  );

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="account_type" value={accountType} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="full_name" label="Your name" required error={e.full_name}>
          <Input id="full_name" name="full_name" autoComplete="name" required maxLength={120} {...invalid("full_name")} />
        </Field>
        <Field id="email" label="Work email" required error={e.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required {...invalid("email")} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="phone" label="Mobile" error={e.phone}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+91 98450 12345" {...invalid("phone")} />
        </Field>
        {accountType === "enterprise" ? companyField : (
          <Field id="venue_website" label={accountType === "venue" ? "Website or Instagram" : "Website or portfolio"} required={accountType === "partner"} error={e.venue_website}>
            <Input id="venue_website" name="venue_website" inputMode="url" required={accountType === "partner"} placeholder={accountType === "venue" ? "yourvenue.in" : "yourstudio.in"} {...invalid("venue_website")} />
          </Field>
        )}
      </div>

      {accountType === "enterprise" ? null : companyField}

      {accountType === "venue" ? (
        <>
          <Field id="venue_address" label="Street address" required error={e.venue_address}>
            <Input id="venue_address" name="venue_address" autoComplete="street-address" required maxLength={300} {...invalid("venue_address")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="city" label="City" required error={e.city}>
              <Input id="city" name="city" autoComplete="address-level2" required maxLength={80} placeholder="Bengaluru" {...invalid("city")} />
            </Field>
            <Field id="venue_area" label="Area" required error={e.venue_area}>
              <Input id="venue_area" name="venue_area" required maxLength={80} placeholder="Indiranagar" {...invalid("venue_area")} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="venue_capacity" label="Most guests you can host" required error={e.venue_capacity}>
              <Input id="venue_capacity" name="venue_capacity" type="number" inputMode="numeric" min={1} max={100000} required placeholder="120" {...invalid("venue_capacity")} />
            </Field>
            {gstinField}
          </div>
        </>
      ) : null}

      {accountType === "partner" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="partner_role" label="What you offer" required error={e.partner_role}>
            <NativeSelect id="partner_role" name="partner_role" required defaultValue="" {...invalid("partner_role")}>
              <option value="" disabled>
                Choose…
              </option>
              {PARTNER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PARTNER_KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {gstinField}
        </div>
      ) : null}

      {state.status === "error" && state.message ? (
        <p role="alert" className="text-destructive text-body">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Mail className="size-4" aria-hidden />}
        Sign up
      </Button>
      <p className="text-fg-subtle text-caption">
        By signing up you agree to our{" "}
        <Link href="/terms" target="_blank" className="text-link underline underline-offset-2">
          Terms of Service
        </Link>{" "}
        and confirm you&apos;ve read our{" "}
        <Link href="/privacy" target="_blank" className="text-link underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
