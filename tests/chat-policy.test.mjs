// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedTools, financeFirstStep, isFinanceQuery } from "../lib/ai/chat-policy.ts";

const ALL = ["searchVenues", "getPlatformMetrics", "analyzeSpend", "forecastBudget"];

test("spend, savings, GST and forecast questions are finance", () => {
  for (const q of [
    "How much did we spend last quarter?",
    "Show spending by department this FY",
    "What's our GST / ITC this year?",
    "Forecast Q4 event costs",
    "rate card savings year-to-date",
    "Will engineering stay within budget this year?",
    "How much budget is left for the sales team?",
    "When do we run out of budget?",
  ]) {
    assert.equal(isFinanceQuery(q), true, q);
  }
});

test("venue searches with a per-head budget are not finance", () => {
  for (const q of [
    "Find a venue for 40 people in Indiranagar, budget 2000 per head",
    "Suggest a rooftop for 25 guests under ₹1,500 per head",
    "Book a private dining room for 12",
    "What venues have a PDR?",
    "Hello!",
  ]) {
    assert.equal(isFinanceQuery(q), false, q);
  }
});

test("platform metrics are admin-only; agent settings are respected", () => {
  assert.deepEqual(allowedTools("ADMIN", ALL), ALL);
  assert.deepEqual(allowedTools("CLIENT", ALL), ["searchVenues", "analyzeSpend", "forecastBudget"]);
  assert.deepEqual(allowedTools("CLIENT", ["searchVenues"]), ["searchVenues"]);
});

test("finance questions must call a finance tool the caller may use", () => {
  assert.deepEqual(financeFirstStep(allowedTools("CLIENT", ALL), "forecast our spend"), {
    activeTools: ["analyzeSpend", "forecastBudget"],
    toolChoice: "required",
  });
  assert.equal(financeFirstStep(ALL, "find a venue for 30 people"), null);
  // Finance tools disabled on the Agents page: no forced call (the prompt forbids guessing).
  assert.equal(financeFirstStep(["searchVenues"], "how much did we spend?"), null);
});
