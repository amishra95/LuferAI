import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_WORKSPACE,
  hasWorkspaceParams,
  isEmptyWorkspace,
  reconcileUrl,
  readWorkspaceParams,
  sameWorkspace,
  workspaceHref,
  workspaceReducer,
  writeWorkspaceParams,
} from "../lib/workspace/state.ts";

const run = (actions, from = EMPTY_WORKSPACE) => actions.reduce(workspaceReducer, from);
const qs = (s) => new URLSearchParams(s);

test("select sets the active id per kind and keeps the others", () => {
  const s = run([
    { type: "select", entity: { kind: "agent", id: "venue-sourcer" } },
    { type: "select", entity: { kind: "trace", id: "9f1c2a7b3d4e5f60" } },
  ]);
  assert.equal(s.activeAgentId, "venue-sourcer");
  assert.equal(s.activeTraceId, "9f1c2a7b3d4e5f60");
  assert.equal(s.activeVenueId, null);
  assert.equal(s.activeRunId, null);
  assert.equal(s.inspecting, null);
});

test("select with inspect opens the inspector on that entity", () => {
  const s = run([{ type: "select", entity: { kind: "venue", id: "extranet:12" }, inspect: true }]);
  assert.deepEqual(s.inspecting, { kind: "venue", id: "extranet:12" });
  assert.equal(s.activeVenueId, "extranet:12");
});

test("an open inspector follows a new selection of the same kind, not of others", () => {
  const open = run([{ type: "select", entity: { kind: "agent", id: "a" }, inspect: true }]);
  assert.deepEqual(run([{ type: "select", entity: { kind: "agent", id: "b" } }], open).inspecting, { kind: "agent", id: "b" });
  assert.deepEqual(run([{ type: "select", entity: { kind: "venue", id: "v1" } }], open).inspecting, { kind: "agent", id: "a" });
});

test("invalid kinds and ids are ignored and return the same state", () => {
  const s = run([{ type: "select", entity: { kind: "agent", id: "a" } }]);
  for (const entity of [{ kind: "booking", id: "x" }, { kind: "agent", id: "" }, { kind: "agent", id: "../etc" }, { kind: "agent", id: "a".repeat(200) }]) {
    assert.equal(workspaceReducer(s, { type: "select", entity }), s);
  }
});

test("no-op transitions return the identical object (no re-render)", () => {
  const s = run([{ type: "select", entity: { kind: "agent", id: "a" }, inspect: true }]);
  assert.equal(workspaceReducer(s, { type: "select", entity: { kind: "agent", id: "a" }, inspect: true }), s);
  assert.equal(workspaceReducer(s, { type: "inspect", kind: "agent" }), s);
  assert.equal(workspaceReducer(s, { type: "clear", kind: "venue" }), s);
  assert.equal(workspaceReducer(s, { type: "clearFilters" }), s);
  assert.equal(workspaceReducer(EMPTY_WORKSPACE, { type: "closeInspector" }), EMPTY_WORKSPACE);
  assert.equal(workspaceReducer(EMPTY_WORKSPACE, { type: "reset" }), EMPTY_WORKSPACE);
});

test("clear removes one kind and closes the inspector only if it showed that kind", () => {
  const s = run([
    { type: "select", entity: { kind: "agent", id: "a" } },
    { type: "select", entity: { kind: "run", id: "r1" }, inspect: true },
  ]);
  const noAgent = workspaceReducer(s, { type: "clear", kind: "agent" });
  assert.equal(noAgent.activeAgentId, null);
  assert.deepEqual(noAgent.inspecting, { kind: "run", id: "r1" });
  const noRun = workspaceReducer(s, { type: "clear", kind: "run" });
  assert.equal(noRun.activeRunId, null);
  assert.equal(noRun.inspecting, null);
});

test("inspect opens an active kind and does nothing without one", () => {
  const s = run([{ type: "select", entity: { kind: "trace", id: "t1" } }]);
  assert.deepEqual(workspaceReducer(s, { type: "inspect", kind: "trace" }).inspecting, { kind: "trace", id: "t1" });
  assert.equal(workspaceReducer(s, { type: "inspect", kind: "venue" }), s);
});

test("closeInspector keeps the active entities", () => {
  const s = run([{ type: "select", entity: { kind: "agent", id: "a" }, inspect: true }, { type: "closeInspector" }]);
  assert.equal(s.inspecting, null);
  assert.equal(s.activeAgentId, "a");
});

test("filters: set, overwrite, remove with an empty value, and validate keys", () => {
  let s = run([{ type: "setFilter", key: "channel", value: " slack " }]);
  assert.deepEqual(s.filters, { channel: "slack" });
  s = workspaceReducer(s, { type: "setFilter", key: "channel", value: "web" });
  assert.deepEqual(s.filters, { channel: "web" });
  assert.equal(workspaceReducer(s, { type: "setFilter", key: "Bad Key", value: "x" }), s);
  assert.deepEqual(workspaceReducer(s, { type: "setFilter", key: "channel", value: "" }).filters, {});
  assert.deepEqual(workspaceReducer(s, { type: "clearFilters" }).filters, {});
});

test("filters are capped at 12", () => {
  const s = run(Array.from({ length: 15 }, (_, i) => ({ type: "setFilter", key: `f${i}`, value: "1" })));
  assert.equal(Object.keys(s.filters).length, 12);
  // Updating an existing key still works at the cap.
  assert.equal(workspaceReducer(s, { type: "setFilter", key: "f0", value: "2" }).filters.f0, "2");
});

test("reset returns the empty state", () => {
  const s = run([
    { type: "select", entity: { kind: "agent", id: "a" }, inspect: true },
    { type: "setFilter", key: "channel", value: "web" },
    { type: "reset" },
  ]);
  assert.equal(s, EMPTY_WORKSPACE);
  assert.ok(isEmptyWorkspace(s));
});

test("hydrate replaces the state, keeping identity when nothing changed", () => {
  const s = run([{ type: "select", entity: { kind: "agent", id: "a" } }]);
  const copy = { ...s, filters: { ...s.filters } };
  assert.equal(workspaceReducer(s, { type: "hydrate", state: copy }), s);
  const other = { ...EMPTY_WORKSPACE, activeVenueId: "v1" };
  assert.equal(workspaceReducer(s, { type: "hydrate", state: other }), other);
});

test("readWorkspaceParams parses ids, filters and inspect", () => {
  const s = readWorkspaceParams(qs("range=7d&agentId=venue-sourcer&traceId=abc123&wf.channel=slack&inspect=trace"));
  assert.deepEqual(s, {
    activeAgentId: "venue-sourcer",
    activeVenueId: null,
    activeTraceId: "abc123",
    activeRunId: null,
    filters: { channel: "slack" },
    inspecting: { kind: "trace", id: "abc123" },
  });
});

test("readWorkspaceParams drops invalid ids, filters and an inspect without an id", () => {
  const s = readWorkspaceParams(qs("agentId=%3Cscript%3E&venueId=&wf.Bad=1&wf.ok=&inspect=venue&runId=r-1"));
  assert.equal(s.activeAgentId, null);
  assert.equal(s.activeVenueId, null);
  assert.equal(s.activeRunId, "r-1");
  assert.deepEqual(s.filters, {});
  assert.equal(s.inspecting, null);
  assert.equal(readWorkspaceParams(qs("agentId=a&inspect=bogus")).inspecting, null);
});

test("writeWorkspaceParams keeps page params and replaces workspace ones", () => {
  const state = run([
    { type: "select", entity: { kind: "venue", id: "v1" }, inspect: true },
    { type: "setFilter", key: "tier", value: "partner" },
  ]);
  const out = writeWorkspaceParams(qs("q=copper&sort=name&agentId=old&inspect=agent&wf.stale=1"), state);
  assert.equal(out.toString(), "q=copper&sort=name&venueId=v1&wf.tier=partner&inspect=venue");
  assert.equal(writeWorkspaceParams(qs("q=copper&agentId=a&inspect=agent"), EMPTY_WORKSPACE).toString(), "q=copper");
});

test("URL round trip preserves the state", () => {
  const state = run([
    { type: "select", entity: { kind: "agent", id: "workspace-agent" } },
    { type: "select", entity: { kind: "venue", id: "extranet:12" } },
    { type: "select", entity: { kind: "trace", id: "9f1c2a7b" } },
    { type: "select", entity: { kind: "run", id: "4b9f0d7e-2c1a-4e1b-9a7c-1d2e3f4a5b6c" }, inspect: true },
    { type: "setFilter", key: "channel", value: "whats app" },
  ]);
  const back = readWorkspaceParams(writeWorkspaceParams(qs("range=30d"), state));
  assert.ok(sameWorkspace(back, state));
});

test("hasWorkspaceParams and workspaceHref", () => {
  assert.equal(hasWorkspaceParams(qs("range=7d&q=x")), false);
  assert.equal(hasWorkspaceParams(qs("range=7d&traceId=t")), true);
  assert.equal(hasWorkspaceParams(qs("wf.channel=web")), true);
  assert.equal(workspaceHref("/venues", qs(""), EMPTY_WORKSPACE), "/venues");
  assert.equal(workspaceHref("/venues", qs("q=a"), { ...EMPTY_WORKSPACE, activeAgentId: "a" }), "/venues?q=a&agentId=a");
});

test("reconcileUrl: a changed URL with workspace params wins (deep link, back/forward)", () => {
  const state = run([{ type: "select", entity: { kind: "agent", id: "a" } }]);
  const r = reconcileUrl(state, qs("range=7d&venueId=v1&inspect=venue"), true);
  assert.equal(r.state.activeVenueId, "v1");
  assert.equal(r.state.activeAgentId, null);
  assert.deepEqual(r.state.inspecting, { kind: "venue", id: "v1" });
  assert.equal(r.query, null);
});

test("reconcileUrl: invalid params in a deep link are normalised out of the URL", () => {
  const r = reconcileUrl(EMPTY_WORKSPACE, qs("q=x&agentId=%3Cbad%3E&traceId=t1"), true);
  assert.equal(r.state.activeTraceId, "t1");
  assert.equal(r.query, "q=x&traceId=t1");
});

test("reconcileUrl: state persists across navigation to a plain URL and is written back", () => {
  const state = run([{ type: "select", entity: { kind: "trace", id: "t1" }, inspect: true }]);
  const r = reconcileUrl(state, qs("q=copper"), true);
  assert.equal(r.state, state);
  assert.equal(r.query, "q=copper&traceId=t1&inspect=trace");
});

test("reconcileUrl: a state change is written even when the URL still has old params", () => {
  const cleared = reconcileUrl(EMPTY_WORKSPACE, qs("range=7d&agentId=a&inspect=agent"), false);
  assert.equal(cleared.state, EMPTY_WORKSPACE);
  assert.equal(cleared.query, "range=7d");
  const synced = run([{ type: "select", entity: { kind: "agent", id: "a" } }]);
  assert.equal(reconcileUrl(synced, qs("range=7d&agentId=a"), false).query, null);
});
