"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, KeyRound, Loader2, Lock, X } from "lucide-react";

import {
  removeOpenAIKey,
  saveOpenAISettings,
  savePreferences,
  testAiProviderKeys,
  testOpenAIConnection,
  testSupabaseConnection,
  type FormState,
} from "@/app/(dashboard)/settings/actions";
import { useToast } from "@/components/dashboard/toast";
import { submitWithoutReset } from "@/lib/form-submit";
import type { KeyCheck } from "@/lib/ai/key-check";
import type { OpenAIStatus } from "@/lib/settings/status";
import { cn } from "@/lib/utils";

const IDLE: FormState = { status: "idle" };
const UNREACHABLE: FormState = { status: "error", message: "Couldn't reach the server. Check your connection and try again." };

/** Inline result line: icon + text, so success/failure never relies on colour alone. */
export function Feedback({ state, pending, pendingText }: { state: FormState; pending?: boolean; pendingText?: string }) {
  if (pending && pendingText) {
    return (
      <p role="status" className="text-fg-subtle flex items-center gap-1.5 text-meta">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {pendingText}
      </p>
    );
  }
  if (state.status === "idle" || !state.message) return null;
  const ok = state.status === "success";
  return (
    <p role={ok ? "status" : "alert"} className={cn("animate-in fade-in flex items-center gap-1.5 text-meta duration-200", ok ? "text-sage" : "text-rose")}>
      {ok ? <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden /> : <X className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
      {state.message}
    </p>
  );
}

export function OpenAIForm({ status, editable }: { status: OpenAIStatus; editable: boolean }) {
  const [result, setResult] = useState<FormState>(IDLE);
  const [busy, startBusy] = useTransition();
  const [busyText, setBusyText] = useState("");

  const toast = useToast();

  /** Runs an action; success → toast, failure → inline result (and a toast if the server was unreachable). */
  function run(text: string, fn: () => Promise<FormState>) {
    setBusyText(text);
    startBusy(async () => {
      try {
        const r = await fn();
        setResult(r);
        if (r.status === "success") toast({ tone: "success", title: r.message ?? "Saved" });
      } catch (err) {
        console.error(err);
        setResult(UNREACHABLE);
        toast({ tone: "error", title: "Request failed", description: UNREACHABLE.message });
      }
    });
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
        <p className="border-line bg-surface-hover text-fg-subtle flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-meta leading-5">
          <Lock className="text-fg-faint mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Read-only here. Keys can only be changed from <code className="text-fg-muted font-code">next dev</code> on localhost, because
            this app has no sign-in. In production, set OPENAI_API_KEY in your host&apos;s environment.
          </span>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
        <label className="block">
          <span className="mb-2 flex items-center justify-between">
            <span className="label-mono">API key</span>
            {status.maskedKey && <span className="text-fg-subtle font-mono text-caption">{status.maskedKey}</span>}
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
            {status.modelIsDefault && <span className="text-fg-subtle font-mono text-caption">default</span>}
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
        <button type="submit" disabled={!editable || busy} className="btn btn-secondary">
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
          <Feedback state={result.status === "error" ? result : IDLE} pending={busy} pendingText={busyText} />
        </div>
      </div>
    </form>
  );
}

export function SupabaseTest({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<FormState>(IDLE);
  const toast = useToast();
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={!configured || busy}
        onClick={() =>
          start(async () => {
            try {
              setResult(await testSupabaseConnection());
            } catch (err) {
              console.error(err);
              setResult(UNREACHABLE);
              toast({ tone: "error", title: "Connection test failed", description: UNREACHABLE.message });
            }
          })
        }
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

const PROVIDER_LABEL: Record<KeyCheck["provider"], string> = { google: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic", groq: "Groq" };

/** Checks each AI provider's key with the provider itself; a rejected key is the usual cause of failed AI runs. */
export function AiKeysTest() {
  const [results, setResults] = useState<KeyCheck[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, start] = useTransition();
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setFailed(false);
              try {
                setResults(await testAiProviderKeys());
              } catch (err) {
                console.error(err);
                setFailed(true);
              }
            })
          }
          className="btn"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null} Check AI keys
        </button>
        {failed ? <p className="text-rose text-meta">{UNREACHABLE.message}</p> : null}
      </div>
      {results ? (
        <ul className="divide-line divide-y" aria-live="polite" aria-label="AI provider keys">
          {results.map((r) => (
            <li key={r.provider} className="flex items-center gap-3 py-2 text-meta">
              {r.state === "ok" ? <Check className="text-sage size-4" aria-label="OK" /> : <X className={cn("size-4", r.state === "missing" ? "text-fg-faint" : "text-rose")} aria-label={r.state} />}
              <span className="text-fg w-32 font-medium">{PROVIDER_LABEL[r.provider]}</span>
              <span className={cn(r.state === "rejected" || r.state === "error" ? "text-rose" : "text-fg-subtle")}>{r.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PreferencesForm({ workspaceName, inspectorOpen }: { workspaceName: string; inspectorOpen: boolean }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    try {
      const r = await savePreferences(prev, form);
      if (r.status === "success") toast({ tone: "success", title: "Preferences saved" });
      return r;
    } catch (err) {
      console.error(err);
      toast({ tone: "error", title: "Couldn't save preferences", description: UNREACHABLE.message });
      return UNREACHABLE;
    }
  }, IDLE);
  return (
    <form onSubmit={submitWithoutReset(action)} className="space-y-5">
      <label className="block max-w-sm">
        <span className="label-mono mb-2 block">Workspace name</span>
        <input name="workspaceName" defaultValue={workspaceName} maxLength={40} required className="field" />
        <span className="text-fg-subtle mt-2 block text-meta">Shown in the sidebar and breadcrumb.</span>
      </label>
      <label className="flex cursor-pointer items-center gap-3 text-meta">
        <input type="checkbox" name="inspectorOpen" defaultChecked={inspectorOpen} className="accent-fg size-3.5" />
        <span className="text-fg-muted">Open the Chat inspector by default</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Save preferences
        </button>
        {state.status === "error" && <Feedback state={state} />}
      </div>
    </form>
  );
}
