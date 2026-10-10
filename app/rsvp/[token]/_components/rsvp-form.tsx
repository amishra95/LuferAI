"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_PLUS_ONES, RSVP_LABEL, type RsvpAnswer, type RsvpStatus } from "@/lib/events/rsvp";
import { cn, formatDate } from "@/lib/utils";
import { respondAction, type RsvpFormState } from "../actions";

const ANSWERS: RsvpAnswer[] = ["ACCEPTED", "TENTATIVE", "DECLINED"];

/** Going / maybe / not going, plus guests and dietary notes. Works before hydration (a plain form post). */
export function RsvpForm({ token, status, plusOnes, dietary, deadline }: { token: string; status: RsvpStatus; plusOnes: number; dietary: string; deadline: string | null }) {
  const [state, action, pending] = useActionState<RsvpFormState, FormData>(respondAction.bind(null, token), null);
  const [choice, setChoice] = useState<RsvpStatus>(status);
  const saved = state?.ok ? state.status : status;

  return (
    <form action={action} className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Will you attend?</legend>
        <div className="grid grid-cols-3 gap-2">
          {ANSWERS.map((a) => (
            <label
              key={a}
              className={cn(
                "border-line-strong hover:bg-surface-hover flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring",
                choice === a && "bg-surface-raised border-fg-subtle text-fg"
              )}
            >
              <input type="radio" name="status" value={a} checked={choice === a} onChange={() => setChoice(a)} className="sr-only" required />
              {RSVP_LABEL[a]}
            </label>
          ))}
        </div>
      </fieldset>

      {choice !== "DECLINED" ? (
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="plusOnes">Bringing</Label>
            <Input id="plusOnes" name="plusOnes" type="number" min={0} max={MAX_PLUS_ONES} defaultValue={plusOnes} inputMode="numeric" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dietary">Dietary needs</Label>
            <Input id="dietary" name="dietary" maxLength={200} defaultValue={dietary} placeholder="Vegetarian, Jain, nut allergy…" />
          </div>
        </div>
      ) : null}

      {state && !state.ok ? (
        <p role="alert" className="text-rose text-sm">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sage flex items-center gap-1.5 text-sm">
          <Check className="size-4" aria-hidden /> Thanks, your reply is saved: {RSVP_LABEL[saved].toLowerCase()}.
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="text-fg-subtle text-[12px]">{deadline ? `Reply by ${formatDate(deadline)}. You can change it until then.` : "You can change your reply later from this link."}</span>
        <Button type="submit" disabled={pending || choice === "INVITED"} className="min-h-11">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {saved === "INVITED" ? "Send reply" : "Update reply"}
        </Button>
      </div>
    </form>
  );
}
