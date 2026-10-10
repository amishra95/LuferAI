/**
 * Workspace context: which agent, venue, trace and run the user is looking at,
 * any workspace filters, and whether the inspector is open. The provider
 * (components/workspace/workspace-provider.tsx) keeps this in React state and
 * mirrors it into the URL so a view can be deep-linked:
 *
 *   /admin/analytics?range=7d&agentId=venue-sourcer&traceId=9f1c…&inspect=trace
 *
 * Pure: no React, no Next and no path aliases, so tests can import it directly
 * (tests/workspace-state.test.mjs).
 */

export const ENTITY_KINDS = ["agent", "venue", "trace", "run"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface WorkspaceState {
  activeAgentId: string | null;
  activeVenueId: string | null;
  activeTraceId: string | null;
  activeRunId: string | null;
  /** Workspace-wide filters, e.g. { channel: "slack" }. */
  filters: Readonly<Record<string, string>>;
  /** The entity shown in the inspector, or null when it's closed. */
  inspecting: EntityRef | null;
}

export type WorkspaceAction =
  /** Make an entity active; `inspect` also opens it in the inspector. */
  | { type: "select"; entity: EntityRef; inspect?: boolean }
  /** Clear one kind of active entity (closing the inspector if it showed it). */
  | { type: "clear"; kind: EntityKind }
  /** Open the inspector on an active entity kind (no-op if none is active). */
  | { type: "inspect"; kind: EntityKind }
  | { type: "closeInspector" }
  /** An empty value removes the filter. */
  | { type: "setFilter"; key: string; value: string }
  | { type: "clearFilters" }
  /** Clear every entity, filter and the inspector. */
  | { type: "reset" }
  /** Replace the whole state, e.g. from a deep link or back/forward. */
  | { type: "hydrate"; state: WorkspaceState };

export const EMPTY_WORKSPACE: WorkspaceState = Object.freeze({
  activeAgentId: null,
  activeVenueId: null,
  activeTraceId: null,
  activeRunId: null,
  filters: Object.freeze({}),
  inspecting: null,
});

/** The state field holding each kind's active id. */
export const ACTIVE_KEY = {
  agent: "activeAgentId",
  venue: "activeVenueId",
  trace: "activeTraceId",
  run: "activeRunId",
} as const satisfies Record<EntityKind, keyof WorkspaceState>;

/** URL query parameter for each kind's active id. */
export const PARAM = { agent: "agentId", venue: "venueId", trace: "traceId", run: "runId" } as const satisfies Record<EntityKind, string>;
export const INSPECT_PARAM = "inspect";
export const FILTER_PREFIX = "wf.";

// Ids are uuids, slugs ("venue-sourcer") or prefixed ("extranet:12"). Anything else
// in the URL is ignored rather than sent on to the API.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FILTER_KEY = /^[a-z][a-zA-Z0-9_-]{0,31}$/;
const MAX_FILTER_VALUE = 200;
const MAX_FILTERS = 12;

export const isEntityKind = (v: unknown): v is EntityKind => typeof v === "string" && (ENTITY_KINDS as readonly string[]).includes(v);
export const isEntityId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export const activeId = (state: WorkspaceState, kind: EntityKind): string | null => state[ACTIVE_KEY[kind]];

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "select": {
      const { kind, id } = action.entity;
      if (!isEntityKind(kind) || !isEntityId(id)) return state;
      // An open inspector showing this kind follows the selection.
      const showIt = action.inspect || state.inspecting?.kind === kind;
      const shown = state.inspecting?.kind === kind && state.inspecting.id === id;
      if (activeId(state, kind) === id && (!showIt || shown)) return state;
      return { ...state, [ACTIVE_KEY[kind]]: id, inspecting: showIt ? { kind, id } : state.inspecting };
    }
    case "clear": {
      if (activeId(state, action.kind) === null) return state;
      return { ...state, [ACTIVE_KEY[action.kind]]: null, inspecting: state.inspecting?.kind === action.kind ? null : state.inspecting };
    }
    case "inspect": {
      const id = activeId(state, action.kind);
      if (id === null || (state.inspecting?.kind === action.kind && state.inspecting.id === id)) return state;
      return { ...state, inspecting: { kind: action.kind, id } };
    }
    case "closeInspector":
      return state.inspecting === null ? state : { ...state, inspecting: null };
    case "setFilter": {
      if (!FILTER_KEY.test(action.key)) return state;
      const value = action.value.trim().slice(0, MAX_FILTER_VALUE);
      if ((state.filters[action.key] ?? "") === value) return state;
      const filters = { ...state.filters };
      if (value) {
        if (!(action.key in filters) && Object.keys(filters).length >= MAX_FILTERS) return state;
        filters[action.key] = value;
      } else {
        delete filters[action.key];
      }
      return { ...state, filters };
    }
    case "clearFilters":
      return Object.keys(state.filters).length === 0 ? state : { ...state, filters: {} };
    case "reset":
      return isEmptyWorkspace(state) ? state : EMPTY_WORKSPACE;
    case "hydrate":
      return sameWorkspace(state, action.state) ? state : action.state;
  }
}

export function isEmptyWorkspace(state: WorkspaceState): boolean {
  return sameWorkspace(state, EMPTY_WORKSPACE);
}

export function sameWorkspace(a: WorkspaceState, b: WorkspaceState): boolean {
  if (ENTITY_KINDS.some((k) => activeId(a, k) !== activeId(b, k))) return false;
  if (a.inspecting?.kind !== b.inspecting?.kind || a.inspecting?.id !== b.inspecting?.id) return false;
  const ak = Object.keys(a.filters);
  return ak.length === Object.keys(b.filters).length && ak.every((k) => a.filters[k] === b.filters[k]);
}

/** Whether a query string carries any workspace parameter. */
export function hasWorkspaceParams(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (key === INSPECT_PARAM || key.startsWith(FILTER_PREFIX) || (Object.values(PARAM) as string[]).includes(key)) return true;
  }
  return false;
}

/**
 * Workspace state from a query string. Invalid ids and filters are dropped, and
 * `inspect=<kind>` only opens the inspector when that kind has an id.
 */
export function readWorkspaceParams(params: URLSearchParams): WorkspaceState {
  const ids = Object.fromEntries(
    ENTITY_KINDS.map((k) => {
      const v = params.get(PARAM[k]);
      return [k, isEntityId(v) ? v : null];
    })
  ) as Record<EntityKind, string | null>;

  const filters: Record<string, string> = {};
  for (const [key, raw] of params) {
    if (!key.startsWith(FILTER_PREFIX)) continue;
    const name = key.slice(FILTER_PREFIX.length);
    const value = raw.trim().slice(0, MAX_FILTER_VALUE);
    if (FILTER_KEY.test(name) && value && Object.keys(filters).length < MAX_FILTERS) filters[name] = value;
  }

  const kind = params.get(INSPECT_PARAM);
  const inspecting = isEntityKind(kind) && ids[kind] ? { kind, id: ids[kind] } : null;

  return {
    activeAgentId: ids.agent,
    activeVenueId: ids.venue,
    activeTraceId: ids.trace,
    activeRunId: ids.run,
    filters,
    inspecting,
  };
}

/**
 * A copy of `params` with the workspace parameters replaced by `state`'s.
 * Everything else (a page's own ?range, ?q, ?sort…) is kept as it was.
 */
export function writeWorkspaceParams(params: URLSearchParams, state: WorkspaceState): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === INSPECT_PARAM || key.startsWith(FILTER_PREFIX) || (Object.values(PARAM) as string[]).includes(key)) continue;
    out.append(key, value);
  }
  for (const k of ENTITY_KINDS) {
    const id = activeId(state, k);
    if (id) out.set(PARAM[k], id);
  }
  for (const key of Object.keys(state.filters).sort()) out.set(`${FILTER_PREFIX}${key}`, state.filters[key]);
  // The inspected entity is always one of the active ones, so its id is already in the URL.
  if (state.inspecting && activeId(state, state.inspecting.kind) === state.inspecting.id) out.set(INSPECT_PARAM, state.inspecting.kind);
  return out;
}

/** `pathname?query` with the workspace parameters set from `state`. */
export function workspaceHref(pathname: string, params: URLSearchParams, state: WorkspaceState): string {
  const qs = writeWorkspaceParams(params, state).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Keeps state and URL in step. When the URL changed under us (a deep link, a link
 * that carries workspace params, back/forward) and carries workspace params, the
 * URL wins. Otherwise the state wins: it persists across navigations to plain
 * URLs and is written back into them. `query` is the query string to write, or
 * null when the URL already matches.
 */
export function reconcileUrl(state: WorkspaceState, params: URLSearchParams, urlChanged: boolean): { state: WorkspaceState; query: string | null } {
  const next = urlChanged && hasWorkspaceParams(params) ? readWorkspaceParams(params) : state;
  const query = writeWorkspaceParams(params, next).toString();
  return { state: next, query: query === params.toString() ? null : query };
}
