"use client";

import { useActionState } from "react";
import { Loader2, MessageSquare } from "lucide-react";

import { submitWithoutReset } from "@/lib/form-submit";
import { postApprovalComment, type ApprovalCommentState } from "../actions";

export type ThreadComment = { id: string; author: string; body: string; at: string; mine: boolean };

/** Discussion on a booking's sign-off. Any role in the company can read and post. */
export function ApprovalThread({
  approvalId,
  companyId,
  userId,
  comments,
}: {
  approvalId: string;
  companyId: string;
  userId?: string;
  comments: ThreadComment[];
}) {
  const [state, action, pending] = useActionState<ApprovalCommentState, FormData>(async (prev, form) => {
    const r = await postApprovalComment(prev, form);
    if (r.status === "success") (document.getElementById(`comment-${approvalId}`) as HTMLTextAreaElement | null)?.form?.reset();
    return r;
  }, { status: "idle" });

  return (
    <div className="border-line border-t pt-4">
      <p className="label-mono mb-3 flex items-center gap-1.5">
        <MessageSquare className="size-3" aria-hidden /> Thread · {comments.length}
      </p>
      {comments.length > 0 && (
        <ol className="mb-3 space-y-2.5">
          {comments.map((c) => (
            <li key={c.id} className={c.mine ? "bg-surface-raised rounded-xl px-3.5 py-2.5" : "border-line rounded-xl border px-3.5 py-2.5"}>
              <p className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-fg font-medium">{c.author}</span>
                <time className="text-fg-subtle font-mono text-[11px]">{c.at}</time>
              </p>
              <p className="text-fg-muted mt-1 text-[13px] leading-5 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      {userId ? (
        <form onSubmit={submitWithoutReset(action)} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <input type="hidden" name="approval_id" value={approvalId} />
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="user_id" value={userId} />
          <label htmlFor={`comment-${approvalId}`} className="sr-only">
            Add to the thread
          </label>
          <textarea
            id={`comment-${approvalId}`}
            name="body"
            required
            maxLength={2000}
            rows={1}
            placeholder="Ask a question or add context…"
            className="field field-sizing-content min-h-9 resize-none py-2"
          />
          <button type="submit" disabled={pending} className="btn h-9 shrink-0">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Post
          </button>
        </form>
      ) : null}
      {state.status === "error" && (
        <p role="alert" className="text-rose mt-2 text-[12.5px]">
          {state.message}
        </p>
      )}
    </div>
  );
}
