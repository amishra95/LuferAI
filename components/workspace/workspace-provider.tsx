"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  activeId,
  readWorkspaceParams,
  reconcileUrl,
  workspaceReducer,
  type EntityKind,
  type WorkspaceState,
} from "@/lib/workspace/state";

/**
 * Global workspace context: the active agent, venue, trace and run, workspace
 * filters, and the inspector. Lives in the dashboard shell, so it survives
 * client-side navigation between pages, and is mirrored into the URL
 * (lib/workspace/state.ts) so any view can be deep-linked or shared.
 *
 * URL writes use history.replaceState: no server round trip and no extra
 * history entries for every click.
 */

export interface WorkspaceApi {
  state: WorkspaceState;
  /** Make an entity active without opening the inspector (it follows if open on that kind). */
  select: (kind: EntityKind, id: string) => void;
  /** Make an entity active and open it in the inspector. */
  inspect: (kind: EntityKind, id: string) => void;
  /** Open the inspector on the active entity of a kind, if there is one. */
  inspectActive: (kind: EntityKind) => void;
  clear: (kind: EntityKind) => void;
  closeInspector: () => void;
  /** An empty value removes the filter. */
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  /** Clear every active entity, filter and the inspector. */
  reset: () => void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [state, dispatch] = useReducer(workspaceReducer, query, (q) => readWorkspaceParams(new URLSearchParams(q)));

  // The last query string this effect saw, to tell URL changes from state changes.
  const seenQuery = useRef(query);
  useEffect(() => {
    const urlChanged = query !== seenQuery.current;
    seenQuery.current = query;
    const next = reconcileUrl(state, new URLSearchParams(query), urlChanged);
    if (next.state !== state) dispatch({ type: "hydrate", state: next.state });
    if (next.query !== null) window.history.replaceState(null, "", next.query ? `${pathname}?${next.query}` : pathname);
  }, [state, query, pathname]);

  const api = useMemo<WorkspaceApi>(
    () => ({
      state,
      select: (kind, id) => dispatch({ type: "select", entity: { kind, id } }),
      inspect: (kind, id) => dispatch({ type: "select", entity: { kind, id }, inspect: true }),
      inspectActive: (kind) => dispatch({ type: "inspect", kind }),
      clear: (kind) => dispatch({ type: "clear", kind }),
      closeInspector: () => dispatch({ type: "closeInspector" }),
      setFilter: (key, value) => dispatch({ type: "setFilter", key, value }),
      clearFilters: () => dispatch({ type: "clearFilters" }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [state]
  );

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider> (the dashboard shell).");
  return ctx;
}

/** The active id of one kind, e.g. useActiveEntity("trace"). */
export function useActiveEntity(kind: EntityKind): string | null {
  return activeId(useWorkspace().state, kind);
}
