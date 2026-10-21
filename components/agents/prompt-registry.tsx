"use client";

import { useState } from "react";
import { GitCompare, History, Loader2, Plus, Rocket, Save, Trash2, Undo2 } from "lucide-react";

import { activatePromptAction, deletePromptDraftAction, revertPromptAction, savePromptDraft } from "@/app/(dashboard)/agents/actions";
import { Pill, type PillTone } from "@/components/portal/pills";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { diffLines, diffStats, PROMPT_BODY_LIMITS, PROMPT_NOTE_MAX, type PromptKey, type PromptVersion } from "@/lib/ai/prompt-registry";
import { cn } from "@/lib/utils";

/** The built-in prompt (lib/ai/prompts.ts) as a pseudo-version, so it can be viewed, diffed and drafted from. */
const BUILT_IN_ID = "built-in";

type Entry = { id: string; label: string; status: PromptVersion["status"] | "built-in"; body: string; note: string | null; at: string | null };

const STATUS: Record<Entry["status"], { tone: PillTone; label: string }> = {
  active: { tone: "ok", label: "Live" },
  draft: { tone: "warn", label: "Draft" },
  archived: { tone: "neutral", label: "Archived" },
  "built-in": { tone: "neutral", label: "Built-in" },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/**
 * Draft, edit, compare and activate versions of a negotiation prompt. Drafts
 * are editable; activating archives the live version in the same statement
 * (activate_prompt_version), and the negotiator uses the new one from its next
 * session. Any archived version can be activated again to roll back.
 */
export function PromptRegistry({
  promptKey,
  label,
  builtIn,
  versions,
  ready,
}: {
  promptKey: PromptKey;
  label: string;
  builtIn: string;
  versions: PromptVersion[];
  /** The registry table exists here. */
  ready: boolean;
}) {
  const entries: Entry[] = [
    ...versions.map((v) => ({ id: v.id, label: `v${v.version}`, status: v.status, body: v.body, note: v.note, at: v.activatedAt ?? v.updatedAt })),
    { id: BUILT_IN_ID, label: "Built-in", status: "built-in" as const, body: builtIn, note: "Shipped with the app (lib/ai/prompts.ts)", at: null },
  ];
  const live = entries.find((e) => e.status === "active") ?? entries.find((e) => e.id === BUILT_IN_ID)!;

  const [selectedId, setSelectedId] = useState(live.id);
  const selected = entries.find((e) => e.id === selectedId) ?? live;
  const editable = selected.status === "draft";

  // Unsaved edits per draft, so switching versions doesn't lose them.
  const [edits, setEdits] = useState<Record<string, { body: string; note: string }>>({});
  const body = edits[selected.id]?.body ?? selected.body;
  const note = edits[selected.id]?.note ?? selected.note ?? "";
  const dirty = editable && (body !== selected.body || note !== (selected.note ?? ""));
  const edit = (patch: Partial<{ body: string; note: string }>) => setEdits((e) => ({ ...e, [selected.id]: { body, note, ...patch } }));

  const [compareId, setCompareId] = useState<string | null>(null);
  const compareTo = entries.find((e) => e.id === (compareId ?? (selected.id === live.id ? null : live.id))) ?? null;
  const diff = compareTo ? diffLines(compareTo.body, body) : null;
  const stats = diff ? diffStats(diff) : null;

  const save = useAction<PromptVersion>();
  const act = useAction<unknown>();
  const busy = save.pending || act.pending;

  const saveDraft = async (fromBody: string, fromNote: string, id?: string) => {
    const outcome = await save.run(() => savePromptDraft(promptKey, { id, body: fromBody, note: fromNote }), {
      failure: id ? "Couldn't save the draft" : "Couldn't create a draft",
      success: (v) => ({ tone: "success", title: id ? `Saved v${v.version}` : `Draft v${v.version} created` }),
    });
    if (outcome?.ok) {
      const savedId = outcome.result.id;
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== savedId)));
      setSelectedId(outcome.result.id);
    }
  };

  const activate = async () => {
    if (dirty) return;
    const outcome = await act.run(() => activatePromptAction(selected.id), {
      failure: `Couldn't activate ${selected.label}`,
      success: () => ({ tone: "success", title: `${selected.label} is live`, description: "The negotiator uses it from its next session." }),
    });
    if (outcome?.ok) setCompareId(null);
  };

  if (!ready) {
    return (
      <p role="status" className="border-line text-fg-subtle rounded-lg border border-dashed px-4 py-4 text-meta">
        The prompt registry needs the Supabase database with migration 0028 (agent_prompt_versions). The {label.toLowerCase()} runs on its built-in prompt until then.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label={`${label} prompt versions`} className="grid min-w-0 content-start gap-1">
        <span className="label-mono mb-1 flex items-center gap-1.5">
          <History className="size-3" aria-hidden /> Versions
        </span>
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => {
              setSelectedId(e.id);
              setCompareId(null);
            }}
            aria-current={e.id === selected.id ? "true" : undefined}
            className={cn(
              "flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-meta",
              e.id === selected.id ? "bg-surface-raised text-fg" : "text-fg-subtle hover:bg-surface-hover hover:text-fg"
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="font-mono">{e.label}</span>
              {edits[e.id] && (edits[e.id].body !== e.body || edits[e.id].note !== (e.note ?? "")) ? <span className="text-warn"> •</span> : null}
              {e.note ? <span className="text-fg-faint block truncate text-caption">{e.note}</span> : null}
            </span>
            {e.status !== "archived" ? <Pill tone={STATUS[e.status].tone}>{e.id === live.id && e.status === "built-in" ? "Live" : STATUS[e.status].label}</Pill> : null}
          </button>
        ))}
      </nav>

      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-fg font-mono text-meta">{selected.label}</h3>
          <Pill tone={STATUS[selected.status].tone}>{selected.id === live.id ? "Live" : STATUS[selected.status].label}</Pill>
          {selected.at ? <span className="text-fg-faint text-caption">{selected.status === "draft" ? "edited" : selected.status === "active" ? "live since" : "last live"} {when(selected.at)}</span> : null}
          <label className="text-fg-subtle ml-auto flex items-center gap-1.5 text-caption">
            <GitCompare className="size-3.5" aria-hidden /> Compare with
            <select
              className="field h-7 py-0 text-caption"
              value={compareTo?.id ?? ""}
              onChange={(e) => setCompareId(e.target.value || "none")}
            >
              <option value="">Nothing</option>
              {entries
                .filter((e) => e.id !== selected.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                    {e.id === live.id ? " (live)" : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {diff && compareTo ? (
          <div className="border-line overflow-hidden rounded-lg border">
            <div className="border-line text-fg-subtle flex items-center gap-3 border-b px-3 py-1.5 font-mono text-caption">
              {compareTo.label} → {selected.label}
              <span className="text-sage">+{stats!.added}</span>
              <span className="text-rose">−{stats!.removed}</span>
              {stats!.added + stats!.removed === 0 ? <span>identical</span> : null}
            </div>
            <pre className="max-h-72 overflow-auto py-1 font-code text-caption leading-5" aria-label={`Changes from ${compareTo.label} to ${selected.label}`}>
              {diff.map((d, i) => (
                <div key={i} className={cn("px-3 whitespace-pre-wrap", d.type === "add" && "bg-sage/10 text-fg", d.type === "del" && "bg-rose/10 text-fg-subtle line-through decoration-rose/40")}>
                  <span className="text-fg-faint mr-2 inline-block w-3 select-none" aria-hidden>
                    {d.type === "add" ? "+" : d.type === "del" ? "−" : " "}
                  </span>
                  <span className="sr-only">{d.type === "add" ? "Added: " : d.type === "del" ? "Removed: " : ""}</span>
                  {d.text || " "}
                </div>
              ))}
            </pre>
          </div>
        ) : null}

        <label className="grid gap-1.5">
          <span className="sr-only">Prompt text</span>
          <textarea
            value={body}
            onChange={(e) => edit({ body: e.target.value })}
            readOnly={!editable}
            rows={12}
            maxLength={PROMPT_BODY_LIMITS.max}
            className={cn("field h-auto resize-y py-2 font-mono text-caption leading-5", !editable && "text-fg-muted")}
          />
          <span className="text-fg-faint text-right font-mono text-caption tabular-nums">
            {body.length.toLocaleString("en-IN")} / {PROMPT_BODY_LIMITS.max.toLocaleString("en-IN")}
          </span>
        </label>

        {editable ? (
          <label className="grid gap-1 text-meta">
            <span className="text-fg-subtle">Change note</span>
            <input value={note} onChange={(e) => edit({ note: e.target.value })} maxLength={PROMPT_NOTE_MAX} placeholder="What changed and why" className="field" />
          </label>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <>
              <button type="button" className="btn h-8 px-3 text-meta" disabled={busy || !dirty} onClick={() => saveDraft(body, note, selected.id)}>
                {save.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />} Save draft
              </button>
              <button
                type="button"
                className="btn h-8 px-3 text-meta"
                disabled={busy}
                onClick={() =>
                  act.run(() => deletePromptDraftAction(selected.id), { failure: "Couldn't delete the draft", success: () => ({ tone: "success", title: `Deleted ${selected.label}` }) }).then((o) => {
                    if (o?.ok) setSelectedId(live.id);
                  })
                }
              >
                <Trash2 className="size-3.5" aria-hidden /> Delete
              </button>
            </>
          ) : (
            <button type="button" className="btn h-8 px-3 text-meta" disabled={busy} onClick={() => saveDraft(selected.body, `From ${selected.label}`)}>
              <Plus className="size-3.5" aria-hidden /> New draft from {selected.label}
            </button>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {selected.id === live.id && selected.status === "active" ? (
              <button
                type="button"
                className="btn h-8 px-3 text-meta"
                disabled={busy}
                onClick={() =>
                  act.run(() => revertPromptAction(promptKey), {
                    failure: "Couldn't revert",
                    success: () => ({ tone: "success", title: "Back on the built-in prompt" }),
                  })
                }
              >
                <Undo2 className="size-3.5" aria-hidden /> Revert to built-in
              </button>
            ) : null}
            {selected.status === "draft" || selected.status === "archived" ? (
              <button type="button" className="btn btn-primary h-8 px-3 text-meta" disabled={busy || dirty} title={dirty ? "Save the draft first" : undefined} onClick={activate}>
                {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Rocket className="size-3.5" aria-hidden />}
                {selected.status === "archived" ? `Roll back to ${selected.label}` : `Activate ${selected.label}`}
              </button>
            ) : null}
          </span>
        </div>
        <p className="text-fg-subtle text-caption leading-5">
          The prompt steers the model; it can&apos;t loosen limits. Discount caps, floors, host locks and the host&apos;s approval of every change are enforced in code whatever the
          prompt says. A new version reaches every server within about 15 seconds.
        </p>
      </div>
    </div>
  );
}
