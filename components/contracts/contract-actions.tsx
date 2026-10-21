"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, Loader2, PenLine, X } from "lucide-react";

import { declineContractAction, issueContractAction, signContractAction, voidContractAction } from "@/app/(dashboard)/contracts/actions";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { cn } from "@/lib/utils";

/** Generates the booking's contract and opens it. */
export function IssueContractButton({ bookingId, label = "Issue contract", className }: { bookingId: string; label?: string; className?: string }) {
  const router = useRouter();
  const act = useAction<{ id: string }>();
  return (
    <button
      type="button"
      className={cn("btn", className)}
      disabled={act.pending}
      onClick={async () => {
        const outcome = await act.run(() => issueContractAction(bookingId), { failure: "Couldn't issue the contract" });
        if (outcome?.ok) router.push(`/contracts/${outcome.result.id}`);
      }}
    >
      {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileSignature className="size-3.5" aria-hidden />}
      {label}
    </button>
  );
}

/**
 * The awaited signer's panel: type your name, agree to sign electronically, sign.
 * The document hash shown is the one the signature records; if the contract changed
 * since the page loaded, the server refuses.
 */
export function SignPanel({ contractId, documentSha256, party, defaultName }: { contractId: string; documentSha256: string; party: "client" | "venue"; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const sign = useAction<{ status: string }>();
  const decline = useAction<{ ok: true }>();

  return (
    <div className="panel grid gap-3 p-4">
      <div>
        <h2 className="text-fg text-body font-medium">{party === "client" ? "Sign for your company" : "Countersign for the venue"}</h2>
        <p className="text-fg-subtle mt-1 text-meta leading-5">
          {party === "client"
            ? "The venue countersigns next. The booking is confirmed once both have signed."
            : "Countersigning executes the agreement and confirms the booking: the date is locked and the deposit is captured."}
        </p>
      </div>
      <label className="grid gap-1 text-caption">
        <span className="text-fg-subtle">Full name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" />
      </label>
      <label className="grid gap-1 text-caption">
        <span className="text-fg-subtle">Title (optional)</span>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={party === "client" ? "e.g. Head of Finance" : "e.g. General Manager"} />
      </label>
      <label className="flex items-start gap-2 text-meta leading-5">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="text-fg-muted">I have read this agreement, I am authorised to sign it, and I agree to sign it electronically.</span>
      </label>
      <p className="text-fg-faint font-mono text-caption break-all">SHA-256 {documentSha256}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!consent || name.trim().length < 2 || sign.pending}
          onClick={() =>
            sign.run(() => signContractAction(contractId, { name, title, consent, documentSha256 }), {
              failure: "Couldn't sign",
              success: (r) => ({ tone: "success", title: r.status === "executed" ? "Executed: the booking is confirmed" : "Signed", description: r.status === "executed" ? "Invoices for the deposit and balance are on their way." : "The venue has been asked to countersign." }),
            })
          }
        >
          {sign.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PenLine className="size-3.5" aria-hidden />}
          {party === "client" ? "Sign agreement" : "Countersign and confirm"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setDeclining((d) => !d)}>
          Decline
        </button>
      </div>
      {declining ? (
        <div className="grid gap-2">
          <label className="grid gap-1 text-caption">
            <span className="text-fg-subtle">Why are you declining? The other party sees this.</span>
            <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Guest count is changing" />
          </label>
          <button
            type="button"
            className="btn justify-self-start"
            disabled={decline.pending}
            onClick={() => decline.run(() => declineContractAction(contractId, reason), { failure: "Couldn't decline", success: () => ({ tone: "success", title: "Declined", description: "A corrected revision can be issued." }) })}
          >
            <X className="size-3.5" aria-hidden /> Decline agreement
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function VoidContractButton({ contractId }: { contractId: string }) {
  const act = useAction<{ ok: true }>();
  return (
    <button
      type="button"
      className="btn btn-ghost text-meta"
      disabled={act.pending}
      onClick={() => {
        const reason = prompt("Why are you voiding this contract? Both parties see the reason.");
        if (reason === null) return;
        act.run(() => voidContractAction(contractId, reason), { failure: "Couldn't void the contract", success: () => ({ tone: "success", title: "Contract voided", description: "Issue a new revision when the terms are agreed." }) });
      }}
    >
      Void contract
    </button>
  );
}
