"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { addVenueGstinAction } from "../actions";
import { Feedback, IDLE } from "./host-forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The welcome checklist's "Add your GSTIN" step, for a venue that signed up without it. */
export function GstinForm() {
  const [state, action, pending] = useActionState(addVenueGstinAction, IDLE);
  return (
    <form action={action} className="grid gap-2 pl-10">
      <div className="flex gap-2">
        <Input name="gstin" aria-label="GSTIN" required maxLength={15} autoCapitalize="characters" className="font-mono uppercase" />
        <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
