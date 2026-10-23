"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { AccountType } from "@/lib/auth/onboarding";
import { PARTNER_KIND_LABEL, PARTNER_KINDS, type SignupField } from "@/lib/auth/signup-input";
import { submitSignup, type SignupState } from "../actions";

function Field({ id, label, error, hint, children }: { id: SignupField; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-caption">
          {error}
        </p>
      ) : hint ? (
        <p className="text-fg-subtle text-caption">{hint}</p>
      ) : null}
    </div>
  );
}

/** One form for both account types; the partner variant asks what they offer and for a link to their work. */
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

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="account_type" value={accountType} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="full_name" label="Your name" error={e.full_name}>
          <Input id="full_name" name="full_name" autoComplete="name" required maxLength={120} {...invalid("full_name")} />
        </Field>
        <Field id="email" label="Work email" error={e.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required {...invalid("email")} />
        </Field>
      </div>

      <Field id="company_name" label={accountType === "enterprise" ? "Company (legal name)" : "Business or stage name"} error={e.company_name}>
        <Input id="company_name" name="company_name" autoComplete="organization" required maxLength={120} {...invalid("company_name")} />
      </Field>

      {accountType === "partner" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="partner_role" label="What you offer" error={e.partner_role}>
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
          <Field id="venue_website" label="Website or portfolio" error={e.venue_website} hint="Your site, showreel or Instagram.">
            <Input id="venue_website" name="venue_website" inputMode="url" required placeholder="yourstudio.in" {...invalid("venue_website")} />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="gstin" label={accountType === "enterprise" ? "GSTIN" : "GSTIN (optional)"} error={e.gstin} hint={accountType === "enterprise" ? "Invoices are raised on it." : undefined}>
          <Input id="gstin" name="gstin" required={accountType === "enterprise"} maxLength={15} autoCapitalize="characters" className="font-mono uppercase" {...invalid("gstin")} />
        </Field>
        <Field id="phone" label="Mobile (optional)" error={e.phone}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+91 98450 12345" {...invalid("phone")} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="job_title" label="Your role (optional)" error={e.job_title}>
          <Input id="job_title" name="job_title" autoComplete="organization-title" maxLength={120} />
        </Field>
        <Field id="city" label="City (optional)" error={e.city}>
          <Input id="city" name="city" autoComplete="address-level2" maxLength={80} />
        </Field>
      </div>

      <Field id="message" label="Anything we should know? (optional)" error={e.message}>
        <textarea id="message" name="message" rows={3} maxLength={1000} className="field h-auto py-2" />
      </Field>

      {state.status === "error" && state.message ? (
        <p role="alert" className="text-destructive text-body">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Mail className="size-4" aria-hidden />}
        Apply and confirm my email
      </Button>
    </form>
  );
}
