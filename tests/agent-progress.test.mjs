// Agent progress labels and live activity (lib/agents/tool-progress.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import { activityFromParts, activityFromRunEvents, toolProgress } from "../lib/agents/tool-progress.ts";

test("tool labels: venue search, policy, cards, workspace tools and a fallback", () => {
  for (const n of ["searchVenues", "searchProperties", "queryReservationInventory"]) {
    assert.deepEqual(toolProgress(n), { kind: "search", running: "Searching venue availability", done: "Searched venue availability" });
  }
  for (const n of ["checkPolicy", "validateBudget", "checkSpendPolicy"]) assert.equal(toolProgress(n).running, "Verifying department spend policy");
  for (const n of ["issueVirtualCard", "createCard", "issueCorporateVirtualCard"]) assert.equal(toolProgress(n).running, "Issuing sandboxed virtual card");
  assert.equal(toolProgress("analyzeSpend").running, "Analysing spend");
  assert.deepEqual(toolProgress("sendSlackApprovalRequest"), { kind: "tool", running: "Executing sendSlackApprovalRequest", done: "Ran sendSlackApprovalRequest" });
});

test("activity from streamed parts follows the latest part", () => {
  assert.deepEqual(activityFromParts([]), { kind: "thinking", label: "Thinking", step: null });

  const searching = [{ type: "step-start" }, { type: "tool-searchVenues", state: "input-available" }];
  assert.deepEqual(activityFromParts(searching), { kind: "search", label: "Searching venue availability", step: 1 });

  const reviewing = [{ type: "step-start" }, { type: "tool-searchVenues", state: "output-available" }];
  assert.equal(activityFromParts(reviewing).label, "Reviewing results");

  const policy = [...reviewing, { type: "step-start" }, { type: "dynamic-tool", toolName: "checkSpendPolicy", state: "input-streaming" }];
  assert.deepEqual(activityFromParts(policy), { kind: "policy", label: "Verifying department spend policy", step: 2 });

  const approval = [{ type: "step-start" }, { type: "tool-issueCorporateVirtualCard", state: "approval-requested" }];
  assert.equal(activityFromParts(approval).kind, "approval");

  const writing = [...reviewing, { type: "step-start" }, { type: "text", text: "Here are" }];
  assert.deepEqual(activityFromParts(writing), { kind: "writing", label: "Writing the answer", step: 2 });
});

test("activity from /agents run events tracks open tool calls", () => {
  const call = { type: "tool_call", step: 1, toolCallId: "a", toolName: "createCard", input: {} };
  assert.deepEqual(activityFromRunEvents([call]), { kind: "card", label: "Issuing sandboxed virtual card", step: 1 });
  const done = { type: "tool_response", step: 1, toolCallId: "a", toolName: "createCard", ok: true, output: {} };
  assert.equal(activityFromRunEvents([call, done]).label, "Reviewing results");
  assert.equal(activityFromRunEvents([call, done, { type: "final_output", step: 2, text: "ok" }]).kind, "writing");
  assert.deepEqual(activityFromRunEvents([]), { kind: "thinking", label: "Thinking", step: null });
});
