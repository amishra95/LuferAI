"use client";

import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { EntityKind } from "@/lib/workspace/state";
import { cn } from "@/lib/utils";

/**
 * Click targets that open an entity in the inspector without navigating. Usable
 * from server components: pass plain kind/id props.
 */

const KIND_LABEL: Record<EntityKind, string> = { agent: "agent", venue: "venue", trace: "trace", run: "run" };

function useInspecting(kind: EntityKind, id: string) {
  const { state, inspect } = useWorkspace();
  return { open: () => inspect(kind, id), active: state.inspecting?.kind === kind && state.inspecting.id === id };
}

/** Inline text button: an entity name, id or badge. */
export function InspectButton({
  kind,
  id,
  label,
  className,
  children,
}: {
  kind: EntityKind;
  id: string;
  /** Accessible name, e.g. the entity's display name. Defaults to the id. */
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { open, active } = useInspecting(kind, id);
  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Inspect ${KIND_LABEL[kind]} ${label ?? id}`}
      aria-haspopup="dialog"
      data-active={active || undefined}
      className={cn(
        "decoration-line-strong hover:text-fg data-active:text-fg max-w-full cursor-pointer rounded-sm text-left underline-offset-[3px] hover:underline data-active:underline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-fg-subtle",
        className
      )}
    >
      {children}
    </button>
  );
}

// Clicks on these inside a row keep their own behaviour.
const INTERACTIVE = "a,button,input,select,textarea,summary,label,[role=button]";

/**
 * A list or table row that opens its entity when clicked anywhere. Keyboard and
 * screen-reader users get the same action from an InspectButton inside the row,
 * so the row itself isn't a focus stop.
 */
export function InspectableRow({
  as: Tag = "li",
  kind,
  id,
  className,
  children,
}: {
  as?: "li" | "tr" | "div";
  kind: EntityKind;
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { open, active } = useInspecting(kind, id);
  return (
    <Tag
      onClick={(e: React.MouseEvent<HTMLElement>) => {
        if ((e.target as HTMLElement).closest(INTERACTIVE) || window.getSelection()?.toString()) return;
        open();
      }}
      data-active={active || undefined}
      className={cn("data-active:bg-surface-raised cursor-pointer", className)}
    >
      {children}
    </Tag>
  );
}
