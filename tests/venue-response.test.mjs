import assert from "node:assert/strict";
import test from "node:test";

import { holdLapsed, replyTimeLabel } from "../lib/venues/response.ts";

test("a request lapses after its 24-hour hold", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  assert.equal(holdLapsed("2026-11-07T13:00:00Z", now), false);
  assert.equal(holdLapsed("2026-11-07T11:00:00Z", now), true);
});

test("reply time reads in hours, then days", () => {
  assert.equal(replyTimeLabel(undefined), "—");
  assert.equal(replyTimeLabel(0.4), "Under 1 h");
  assert.equal(replyTimeLabel(5.6), "6 h");
  assert.equal(replyTimeLabel(72), "3 d");
});
