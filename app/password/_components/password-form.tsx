"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN } from "@/lib/auth/password";
import { setPassword, type SetPasswordState } from "../actions";

export function PasswordForm({ email, home }: { email: string; home: string }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, { status: "idle" });

  if (state.status === "saved") {
    return (
      <div className="grid gap-4">
        <p role="status" className="flex items-start gap-2 text-body">
          <CheckCircle2 className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
          Password saved. Next time, sign in with {email} and your password.
        </p>
        <Button asChild size="lg">
          <Link href={home}>Continue</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      {/* Lets password managers save the pair. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          maxLength={72}
          required
          autoFocus
          aria-invalid={state.status === "error"}
        />
        {state.status === "error" ? <p className="text-destructive text-caption">{state.message}</p> : null}
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Save password
      </Button>
    </form>
  );
}
