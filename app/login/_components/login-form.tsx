"use client";

import { useActionState, useState } from "react";
import { Building2, CheckCircle2, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendMagicLink, signInWithGoogle, signInWithPassword, signInWithSso, type MagicLinkState, type PasswordState, type SsoState } from "../actions";

/** `email`: prefilled from /login?email=… (team invite emails link there). */
export function LoginForm({ next, email }: { next: string; email?: string }) {
  const [state, linkAction, linkPending] = useActionState<MagicLinkState, FormData>(sendMagicLink, { status: "idle" });
  const [pw, passwordAction, pwPending] = useActionState<PasswordState, FormData>(signInWithPassword, { status: "idle" });
  const busy = linkPending || pwPending;
  const [sso, ssoAction, ssoPending] = useActionState<SsoState, FormData>(signInWithSso, { status: "idle" });
  const [ssoOpen, setSsoOpen] = useState(false);

  return (
    <div className="grid gap-6">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>

      {ssoOpen ? (
        <form action={ssoAction} className="grid gap-2">
          <input type="hidden" name="next" value={next} />
          <Label htmlFor="sso-email">Work email for single sign-on</Label>
          <div className="flex gap-2">
            <Input id="sso-email" name="email" type="email" autoComplete="email" required autoFocus aria-invalid={sso.status === "error"} />
            <Button type="submit" variant="outline" disabled={ssoPending}>
              {ssoPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Continue
            </Button>
          </div>
          {sso.status === "error" ? <p className="text-destructive text-caption">{sso.message}</p> : null}
        </form>
      ) : (
        <Button type="button" variant="outline" className="-mt-3 w-full" onClick={() => setSsoOpen(true)}>
          <Building2 className="size-4" aria-hidden /> Continue with company SSO
        </Button>
      )}

      <div className="text-muted-foreground flex items-center gap-3 text-caption">
        <span className="bg-border h-px flex-1" />
        or
        <span className="bg-border h-px flex-1" />
      </div>

      {state.status === "sent" ? (
        <p role="status" className="flex items-start gap-2 text-body">
          <CheckCircle2 className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
          {state.message}
        </p>
      ) : (
        <form action={passwordAction} className="grid gap-3">
          <input type="hidden" name="next" value={next} />
          <div className="grid gap-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={email}
              required
              aria-invalid={state.status === "error"}
            />
            {state.status === "error" ? <p className="text-destructive text-caption">{state.message}</p> : null}
          </div>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="password">Password</Label>
              {/* Same email link, landing on /password. formNoValidate: no password needed for this. */}
              <button
                type="submit"
                name="intent"
                value="reset"
                formAction={linkAction}
                formNoValidate
                disabled={busy}
                className="text-link text-caption underline-offset-2 hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={pw.status === "error"}
            />
            {pw.status === "error" ? <p className="text-destructive text-caption">{pw.message}</p> : null}
          </div>
          <Button type="submit" size="lg" disabled={busy}>
            {pwPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Sign in
          </Button>
          <Button type="submit" variant="ghost" formAction={linkAction} formNoValidate disabled={busy}>
            {linkPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Mail className="size-4" aria-hidden />}
            Email me a sign-in link
          </Button>
        </form>
      )}
    </div>
  );
}
