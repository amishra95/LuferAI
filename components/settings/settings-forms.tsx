"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { CheckCircle2, KeyRound, Loader2, Lock, PlugZap, Trash2, XCircle } from "lucide-react";

import {
  removeOpenAIKey,
  saveOpenAISettings,
  savePreferences,
  testOpenAIConnection,
  type FormState,
} from "@/app/(dashboard)/settings/actions";
import { submitWithoutReset } from "@/lib/form-submit";
import { cn } from "@/lib/utils";
import type { OpenAIStatus } from "@/lib/settings/status";

const IDLE: FormState = { status: "idle" };

export const fieldClass =
  "h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none disabled:opacity-50";

const primaryBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50";
const secondaryBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50";

export function FormMessage({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  const ok = state.status === "success";
  return (
    <p role={ok ? "status" : "alert"} className={cn("flex items-center gap-1.5 text-xs", ok ? "text-emerald-400" : "text-red-400")}>
      {ok ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : <XCircle className="size-3.5 shrink-0" aria-hidden />}
      {state.message}
    </p>
  );
}

export function OpenAIForm({ status, editable }: { status: OpenAIStatus; editable: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saveState, save, saving] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await saveOpenAISettings(prev, fd);
    if (result.status === "success") formRef.current?.reset(); // clear the key field; keep input on errors
    return result;
  }, IDLE);
  const [other, setOther] = useState<FormState>(IDLE);
  const [busy, startBusy] = useTransition();
  // Show the newest result: an action that resolves later replaces the other's message.
  const [lastSource, setLastSource] = useState<"save" | "other">("save");
  const message = lastSource === "save" ? saveState : other;

  function run(fn: () => Promise<FormState>) {
    setLastSource("other");
    startBusy(async () => setOther(await fn()));
  }

  return (
    // method="post": if JS hasn't loaded, a native submit must never put the key in the URL.
    <form ref={formRef} method="post" onSubmit={submitWithoutReset((fd) => { setLastSource("save"); save(fd); })} className="space-y-4">
      {!editable && (
        <p className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Read-only here. Keys can be edited only from <code className="font-mono text-zinc-300">next dev</code> on localhost,
          because this app has no sign-in. In production, set OPENAI_API_KEY in your host&apos;s environment variables.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            API key
            {status.maskedKey && <span className="font-mono text-zinc-500">current: {status.maskedKey}</span>}
          </span>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-2 left-2.5 size-4 text-zinc-600" aria-hidden />
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={!editable}
              placeholder={status.configured ? "Leave blank to keep current key" : "sk-…"}
              className={cn(fieldClass, "pl-8 font-mono")}
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            Model
            {status.modelIsDefault && <span className="text-zinc-500">default</span>}
          </span>
          <input
            name="model"
            defaultValue={status.modelIsDefault ? "" : status.model}
            placeholder={status.model}
            disabled={!editable}
            spellCheck={false}
            className={cn(fieldClass, "font-mono")}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!editable || saving} className={primaryBtn}>
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Save
        </button>
        <button type="button" onClick={() => run(testOpenAIConnection)} disabled={!status.configured || busy} className={secondaryBtn}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PlugZap className="size-3.5" aria-hidden />}
          Test connection
        </button>
        {status.source === "env-file" && (
          <button
            type="button"
            onClick={() => run(removeOpenAIKey)}
            disabled={!editable || busy}
            className={cn(secondaryBtn, "text-red-300 hover:border-red-500/40 hover:bg-red-500/10")}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remove key
          </button>
        )}
        <div className="basis-full sm:ml-2 sm:basis-auto">
          <FormMessage state={message} />
        </div>
      </div>
    </form>
  );
}

export function PreferencesForm({ workspaceName, inspectorOpen }: { workspaceName: string; inspectorOpen: boolean }) {
  const [state, action, pending] = useActionState(savePreferences, IDLE);
  return (
    <form onSubmit={submitWithoutReset(action)} className="space-y-4">
      <label className="block max-w-sm">
        <span className="mb-1 block text-xs text-zinc-400">Workspace name</span>
        <input name="workspaceName" defaultValue={workspaceName} maxLength={40} required className={fieldClass} />
        <span className="mt-1 block text-xs text-zinc-500">Shown in the sidebar and breadcrumb.</span>
      </label>
      <label className="flex items-center gap-2.5 text-sm text-zinc-300">
        <input type="checkbox" name="inspectorOpen" defaultChecked={inspectorOpen} className="size-4 accent-emerald-500" />
        Open the Chat inspector by default
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Save preferences
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
