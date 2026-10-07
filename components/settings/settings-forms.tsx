"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, KeyRound, Loader2, Lock, X } from "lucide-react";

import {
  removeOpenAIKey,
  saveOpenAISettings,
  savePreferences,
  testOpenAIConnection,
  testSupabaseConnection,
  type FormState,
} from "@/app/(dashboard)/settings/actions";
import { submitWithoutReset } from "@/lib/form-submit";
import type { OpenAIStatus } from "@/lib/settings/status";
import { cn } from "@/lib/utils";

const IDLE: FormState = { status: "idle" };

/** Inline result line: icon + text, so success/failure never relies on colour alone. */
export function Feedback({ state, pending, pendingText }: { state: FormState; pending?: boolean; pendingText?: string }) {
  if (pending && pendingText) {
    return (
      <p role="status" className="text-fg-subtle flex items-center gap-1.5 text-[12.5px]">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {pendingText}
      </p>
    );
  }
  if (state.status === "idle" || !state.message) return null;
  const ok = state.status === "success";
  return (
    <p role={ok ? "status" : "alert"} className={cn("animate-in fade-in flex items-center gap-1.5 text-[12.5px] duration-200", ok ? "text-sage" : "text-rose")}>
      {ok ? <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden /> : <X className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
      {state.message}
    </p>
  );
}

export function OpenAIForm({ status, editable }: { status: OpenAIStatus; editable: boolean }) {
  const [result, setResult] = useState<FormState>(IDLE);
  const [busy, startBusy] = useTransition();
  const [busyText, setBusyText] = useState("");

  function run(text: string, fn: () => Promise<FormState>) {
    setBusyText(text);
    startBusy(async () => setResult(await fn()));
  }

  // Save, then immediately verify the key against OpenAI so the user gets one clear answer.
  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); // also avoids React's automatic reset, so input survives errors
    const el = e.currentTarget;
    const form = new FormData(el);
    const savingKey = Boolean(String(form.get("apiKey") ?? "").trim());
    run(savingKey ? "Saving and verifying key…" : "Saving…", async () => {
      const saved = await saveOpenAISettings(IDLE, form);
      if (saved.status !== "success") return saved;
      el.reset(); // clear the key field; on errors the input is kept
      if (!savingKey) return saved;
      const tested = await testOpenAIConnection();
      return { status: tested.status, message: `Saved. ${tested.message}` };
    });
  }

  return (
    // method="post": if JS hasn't loaded, a native submit must never put the key in the URL.
    <form method="post" onSubmit={save} className="space-y-5">
      {!editable && (
        <p className="border-line bg-zinc-50 text-fg-subtle flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px] leading-5">
          <Lock className="text-fg-faint mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Read-only here. Keys can only be changed from <code className="text-fg-muted font-mono">next dev</code> on localhost, because
            this app has no sign-in. In production, set OPENAI_API_KEY in your host&apos;s environment.
          </span>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
        <label className="block">
          <span className="mb-2 flex items-center justify-between">
            <span className="label-mono">API key</span>
            {status.maskedKey && <span className="text-fg-subtle font-mono text-[11px]">{status.maskedKey}</span>}
          </span>
          <span className="relative block">
            <KeyRound className="text-fg-faint pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" aria-hidden />
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={!editable}
              placeholder={status.configured ? "Leave blank to keep the current key" : "sk-…"}
              className="field pl-9 font-mono"
            />
          </span>
        </label>
        <label className="block">
          <span className="mb-2 flex items-center justify-between">
            <span className="label-mono">Model</span>
            {status.modelIsDefault && <span className="text-fg-subtle font-mono text-[11px]">default</span>}
          </span>
          <input
            name="model"
            defaultValue={status.modelIsDefault ? "" : status.model}
            placeholder={status.model}
            disabled={!editable}
            spellCheck={false}
            className="field font-mono"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <button type="submit" disabled={!editable || busy} className="btn btn-primary">
          Save
        </button>
        <button type="button" onClick={() => run("Contacting OpenAI…", testOpenAIConnection)} disabled={!status.configured || busy} className="btn">
          Test connection
        </button>
        {status.source === "env-file" && (
          <button
            type="button"
            onClick={() => run("Removing key…", removeOpenAIKey)}
            disabled={!editable || busy}
            className="btn btn-ghost hover:text-rose ml-auto"
          >
            Remove key
          </button>
        )}
        <div className="w-full empty:hidden" aria-live="polite">
          <Feedback state={result} pending={busy} pendingText={busyText} />
        </div>
      </div>
    </form>
  );
}

export function SupabaseTest({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<FormState>(IDLE);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={!configured || busy}
        onClick={() => start(async () => setResult(await testSupabaseConnection()))}
        className="btn"
        title={configured ? undefined : "Set the Supabase env vars first"}
      >
        Test connection
      </button>
      <div aria-live="polite">
        <Feedback state={result} pending={busy} pendingText="Pinging Supabase…" />
      </div>
    </div>
  );
}

export function PreferencesForm({ workspaceName, inspectorOpen }: { workspaceName: string; inspectorOpen: boolean }) {
  const [state, action, pending] = useActionState(savePreferences, IDLE);
  return (
    <form onSubmit={submitWithoutReset(action)} className="space-y-5">
      <label className="block max-w-sm">
        <span className="label-mono mb-2 block">Workspace name</span>
        <input name="workspaceName" defaultValue={workspaceName} maxLength={40} required className="field" />
        <span className="text-fg-subtle mt-2 block text-[12.5px]">Shown in the sidebar and breadcrumb.</span>
      </label>
      <label className="flex cursor-pointer items-center gap-3 text-[13px]">
        <input type="checkbox" name="inspectorOpen" defaultChecked={inspectorOpen} className="accent-copper size-3.5" />
        <span className="text-fg-muted">Open the Chat inspector by default</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Save preferences
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
