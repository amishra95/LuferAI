// Run with: npm test
// New-password rules shared by /signup and /password (lib/auth/password.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { passwordProblem } from "../../lib/auth/password.ts";

describe("passwordProblem", () => {
  test("refuses fewer than 8 characters", () => {
    assert.match(passwordProblem(""), /at least 8/);
    assert.match(passwordProblem("1234567"), /at least 8/);
  });
  test("accepts 8 to 72 bytes", () => {
    assert.equal(passwordProblem("12345678"), null);
    assert.equal(passwordProblem("a".repeat(72)), null);
  });
  test("refuses more than 72 bytes, counting multibyte characters", () => {
    assert.match(passwordProblem("a".repeat(73)), /too long/);
    assert.match(passwordProblem("₹".repeat(25)), /too long/); // 75 bytes, 25 characters
  });
});
