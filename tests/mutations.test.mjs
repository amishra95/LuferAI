import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPatchFromForm, applyAgentPatch, instructionsSuffix, isConfiguredAgent, validateAgentPatch } from "../lib/agents/config.ts";
import { ActionError, dispatch, GENERIC_ERROR, unwrap } from "../lib/mutations/dispatch.ts";
import { createOptimisticState, errorMessage } from "../lib/mutations/optimistic.ts";
import { parseTelemetryEvent, visibleTo } from "../lib/telemetry/events.ts";
import { eventsAfter, isStale } from "../lib/telemetry/refresh.ts";
import { refreshSeqFor } from "../lib/telemetry/stream-state.ts";

/** A promise you settle from the test. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

// ----------------------------------------------------------------------------
// Optimistic state
// ----------------------------------------------------------------------------

test("optimistic: shows the change at once and commits it on success", async () => {
  const s = createOptimisticState({ enabled: false, n: 0 });
  const req = deferred();
  const done = s.mutate({ apply: (v) => ({ ...v, enabled: true }), run: () => req.promise });
  assert.equal(s.view().enabled, true);
  assert.equal(s.base().enabled, false);
  assert.equal(s.pending(), 1);
  req.resolve("ok");
  assert.deepEqual(await done, { ok: true, result: "ok" });
  assert.equal(s.base().enabled, true);
  assert.equal(s.view().enabled, true);
  assert.equal(s.pending(), 0);
});

test("optimistic: rolls back on failure and reports the error", async () => {
  const s = createOptimisticState({ enabled: false });
  const out = await s.mutate({ apply: () => ({ enabled: true }), run: async () => Promise.reject(new ActionError("Unknown agent.")) });
  assert.equal(out.ok, false);
  assert.equal(errorMessage(out.error), "Unknown agent.");
  assert.deepEqual(s.view(), { enabled: false });
  assert.equal(s.pending(), 0);
});

test("optimistic: a failed change rolls back without undoing a concurrent one", async () => {
  const s = createOptimisticState({ tools: ["a"], temperature: null });
  const first = deferred();
  const second = deferred();
  const p1 = s.mutate({ apply: (v) => ({ ...v, tools: ["a", "b"] }), run: () => first.promise });
  const p2 = s.mutate({ apply: (v) => ({ ...v, temperature: 0.5 }), run: () => second.promise });
  assert.deepEqual(s.view(), { tools: ["a", "b"], temperature: 0.5 });

  first.reject(new Error("network"));
  await p1;
  // Restoring a snapshot taken before p1 would also have dropped p2's change.
  assert.deepEqual(s.view(), { tools: ["a"], temperature: 0.5 });

  second.resolve();
  await p2;
  assert.deepEqual(s.base(), { tools: ["a"], temperature: 0.5 });
  assert.deepEqual(s.view(), s.base());
});

test("optimistic: commit lets the server's result win", async () => {
  const s = createOptimisticState({ temperature: null });
  await s.mutate({ apply: () => ({ temperature: 0.333 }), run: async () => ({ temperature: 0.33 }), commit: (_b, saved) => saved });
  assert.deepEqual(s.view(), { temperature: 0.33 });
});

test("optimistic: new server data replaces the base under pending changes", async () => {
  const s = createOptimisticState({ enabled: false, runs: 1 });
  const req = deferred();
  const p = s.mutate({ apply: (v) => ({ ...v, enabled: true }), run: () => req.promise });
  s.setBase({ enabled: false, runs: 5 }); // a live refresh lands mid-flight
  assert.deepEqual(s.view(), { enabled: true, runs: 5 });
  req.reject(new Error("x"));
  await p;
  assert.deepEqual(s.view(), { enabled: false, runs: 5 });
});

test("optimistic: listeners hear view changes only", async () => {
  const s = createOptimisticState(1);
  let calls = 0;
  const off = s.subscribe(() => calls++);
  await s.mutate({ apply: (v) => v + 1, run: async () => {} });
  assert.equal(calls, 1); // 1 → 2 on apply; the commit to 2 changes nothing visible
  s.setBase(2);
  assert.equal(calls, 1);
  off();
  s.setBase(3);
  assert.equal(calls, 1);
});

test("errorMessage: user-facing messages only", () => {
  assert.equal(errorMessage(new ActionError("Assign at least one tool.")), "Assign at least one tool.");
  assert.equal(errorMessage(new TypeError("fetch failed")), "Something went wrong. Try again.");
  assert.equal(errorMessage("weird", "Fallback"), "Fallback");
});

// ----------------------------------------------------------------------------
// Dispatcher
// ----------------------------------------------------------------------------

test("dispatch: success returns data and emits telemetry after the work", async () => {
  const order = [];
  const r = await dispatch("t", async () => (order.push("run"), { id: "a" }), { emit: (d) => order.push(`emit:${d.id}`) });
  assert.deepEqual(r, { ok: true, data: { id: "a" } });
  assert.deepEqual(order, ["run", "emit:a"]);
});

test("dispatch: an ActionError becomes its message and nothing is emitted", async () => {
  let emitted = false;
  const r = await dispatch("t", () => { throw new ActionError("Unknown agent."); }, { emit: () => (emitted = true) });
  assert.deepEqual(r, { ok: false, error: "Unknown agent." });
  assert.equal(emitted, false);
});

test("dispatch: unexpected errors are logged and reported generically", async () => {
  const logged = [];
  const r = await dispatch("agents/update", () => Promise.reject(new Error("redis: ECONNRESET")), { log: (m) => logged.push(m) });
  assert.deepEqual(r, { ok: false, error: GENERIC_ERROR });
  assert.deepEqual(logged, ["agents/update: failed"]);
});

test("dispatch: framework errors are re-thrown (redirects to /login still work)", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login" });
  const rethrow = (err) => {
    if (err && typeof err === "object" && "digest" in err) throw err;
  };
  await assert.rejects(dispatch("t", () => { throw redirect; }, { rethrow }), redirect);
  assert.equal((await dispatch("t", () => { throw new ActionError("x"); }, { rethrow })).ok, false);
});

test("dispatch: a telemetry failure doesn't fail the mutation", async () => {
  const logged = [];
  const r = await dispatch("t", () => 1, { emit: () => Promise.reject(new Error("down")), log: (m) => logged.push(m) });
  assert.deepEqual(r, { ok: true, data: 1 });
  assert.deepEqual(logged, ["t: telemetry failed"]);
});

test("unwrap: data out, failures thrown as ActionError", () => {
  assert.equal(unwrap({ ok: true, data: 5 }), 5);
  assert.throws(() => unwrap({ ok: false, error: "Nope." }), (e) => e.name === "ActionError" && e.message === "Nope.");
});

test("dispatch + optimistic: a failed server action rolls the UI back with its reason", async () => {
  const s = createOptimisticState({ enabled: true });
  const action = () => dispatch("agents/update", () => { throw new ActionError("Unknown agent."); });
  const out = await s.mutate({ apply: () => ({ enabled: false }), run: async () => unwrap(await action()) });
  assert.deepEqual(s.view(), { enabled: true });
  assert.equal(errorMessage(out.error), "Unknown agent.");
});

// ----------------------------------------------------------------------------
// Agent config validation (shared by the action and the form)
// ----------------------------------------------------------------------------

test("validateAgentPatch accepts each field and returns only what was given", () => {
  assert.deepEqual(validateAgentPatch("workspace-agent", { enabled: false }), { ok: true, patch: { enabled: false } });
  assert.deepEqual(validateAgentPatch("venue-sourcer", { tools: ["analyzeSpend", "searchVenues", "searchVenues"], temperature: 0.456, maxSteps: 3 }), {
    ok: true,
    patch: { tools: ["searchVenues", "analyzeSpend"], temperature: 0.46, maxSteps: 3 },
  });
  assert.deepEqual(validateAgentPatch("channel-concierge", { instructions: "  Prefer Indiranagar.\r\n " }), { ok: true, patch: { instructions: "Prefer Indiranagar." } });
  assert.deepEqual(validateAgentPatch("venue-sourcer", { instructions: "" }), { ok: true, patch: { instructions: "" } });
});

test("validateAgentPatch rejects bad input with the user-facing reason", () => {
  const err = (agent, input) => validateAgentPatch(agent, input).error;
  assert.equal(err("a", null), "Invalid change.");
  assert.equal(err("a", {}), "Nothing to change.");
  assert.equal(err("a", { enabled: "yes" }), "Invalid enabled value.");
  assert.equal(err("a", { tools: [] }), "Assign at least one tool.");
  assert.equal(err("a", { tools: ["rm -rf"] }), "Unknown tool.");
  assert.match(err("a", { temperature: 3 }), /between 0 and 2/);
  assert.match(err("a", { maxSteps: 2.5 }), /whole number from 1 to 10/);
  assert.match(err("workspace-agent", { instructions: "x".repeat(1001) }), /at most 1000/);
  assert.equal(err("venue-sourcer", { instructions: "be terse" }), "This agent doesn't take custom instructions.");
});

test("agentPatchFromForm: blank temperature is the model default; blank steps is an error", () => {
  assert.deepEqual(agentPatchFromForm("venue-sourcer", { tools: ["searchVenues"], temperature: " ", maxSteps: "4" }), {
    ok: true,
    patch: { tools: ["searchVenues"], temperature: null, maxSteps: 4 },
  });
  assert.equal(agentPatchFromForm("venue-sourcer", { tools: ["searchVenues"], temperature: "", maxSteps: "" }).ok, false);
});

test("applyAgentPatch copies, never mutates; instructionsSuffix and isConfiguredAgent", () => {
  const rec = { id: "a", enabled: true, tools: ["searchVenues"], temperature: null, maxSteps: 3, instructions: "" };
  const next = applyAgentPatch(rec, { enabled: false, tools: ["analyzeSpend"] });
  assert.deepEqual(next, { ...rec, enabled: false, tools: ["analyzeSpend"] });
  assert.deepEqual(rec.tools, ["searchVenues"]);
  assert.equal(instructionsSuffix(""), "");
  assert.equal(instructionsSuffix("   "), "");
  assert.match(instructionsSuffix("Be brief."), /\n\nOperator instructions .*\nBe brief\.$/);
  assert.equal(isConfiguredAgent("venue-sourcer"), true);
  assert.equal(isConfiguredAgent("brief-writer"), false);
});

// ----------------------------------------------------------------------------
// Mutation events and cross-view refresh
// ----------------------------------------------------------------------------

const cfgEv = { seq: 7, at: 1, type: "agent-config", agentId: "workspace-agent", enabled: false, changed: ["enabled"] };
const venueEv = { seq: 8, at: 2, type: "venue-updated", venueId: "extranet:42", change: "unpublished" };

test("mutation events parse, validate and reach the right audience", () => {
  assert.deepEqual(parseTelemetryEvent(JSON.stringify(cfgEv)), cfgEv);
  assert.deepEqual(parseTelemetryEvent(JSON.stringify(venueEv)), venueEv);
  assert.equal(parseTelemetryEvent(JSON.stringify({ ...cfgEv, changed: ["prompt"] })), null);
  assert.equal(parseTelemetryEvent(JSON.stringify({ ...venueEv, change: "renamed" })), null);
  assert.equal(visibleTo(cfgEv, { ops: false, venues: true }), false);
  assert.equal(visibleTo(venueEv, { ops: false, venues: true }), true);
});

test("the inspector reloads an agent on its config change, a venue on its own edit", () => {
  const events = [cfgEv, venueEv];
  assert.equal(refreshSeqFor(events, "agent", "workspace-agent"), 7);
  assert.equal(refreshSeqFor(events, "agent", "venue-sourcer"), 0);
  assert.equal(refreshSeqFor(events, "venue", "extranet:42"), 8);
  assert.equal(refreshSeqFor(events, "venue", "extranet:1"), 0);
});

test("isStale: which pages refresh for which events", () => {
  const run = { type: "run" };
  assert.equal(isStale("/agents", [cfgEv]), true);
  assert.equal(isStale("/chat", [cfgEv]), true);
  assert.equal(isStale("/venues", [cfgEv]), false);
  assert.equal(isStale("/venues", [venueEv]), true);
  assert.equal(isStale("/partner", [venueEv]), true);
  assert.equal(isStale("/admin/analytics", [run]), true);
  assert.equal(isStale("/admin", [run]), false);
  assert.equal(isStale("/agents-old", [cfgEv]), false); // prefix match is per segment
  assert.equal(isStale("/admin/analytics", [{ type: "span" }]), false);
  assert.equal(isStale("/agents", []), false);
});

test("eventsAfter returns only events past the cursor", () => {
  const events = [{ seq: 3 }, { seq: 5 }, { seq: 9 }];
  assert.deepEqual(eventsAfter(events, 4), [{ seq: 5 }, { seq: 9 }]);
  assert.deepEqual(eventsAfter(events, 9), []);
  assert.deepEqual(eventsAfter(events, 0), events);
});
