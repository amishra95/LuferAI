"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { verifyEmailCode, type CodeState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shown once a sign-in or confirmation email is on its way: the email carries
 * a link and a 6-digit code, and the code works where the link can't (another
 * device, or a mail scanner that used the link up).
 */
export function EmailCodeForm({ email, next = "" }: { email: string; next?: string }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(verifyEmailCode, { status: "idle" });
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-2">
        <Label htmlFor="code">Or enter the code from the email</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,12}"
          maxLength={12}
          required
          className="font-mono tracking-[0.2em]"
          aria-invalid={state.status === "error"}
          aria-describedby={state.status === "error" ? "code-error" : undefined}
        />
        {state.status === "error" ? (
          <p id="code-error" className="text-destructive text-caption">
            {state.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Continue
      </Button>
    </form>
  );
}
