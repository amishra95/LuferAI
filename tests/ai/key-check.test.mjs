// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// AI key check (lib/ai/key-check.ts): each provider's free list-models call,
// read as ok / rejected / error, with the key never echoed back.
import "../support/server-actions.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

const { checkProviderKey, checkAllProviderKeys } = await import("../../lib/ai/key-check.ts");

const KEYS = ["GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const reply = (status) => async () => new Response("{}", { status });

test("a missing key is reported without calling the provider", async () => {
  delete process.env.GROQ_API_KEY;
  let called = false;
  const r = await checkProviderKey("groq", async () => ((called = true), new Response("{}")));
  assert.equal(r.state, "missing");
  assert.equal(called, false);
});

test("200 is ok; 401/403 (and Google's 400) are a rejected key; other statuses are errors", async () => {
  process.env.OPENAI_API_KEY = "sk-secret-value";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-secret-value";
  assert.equal((await checkProviderKey("openai", reply(200))).state, "ok");
  assert.equal((await checkProviderKey("openai", reply(401))).state, "rejected");
  assert.equal((await checkProviderKey("openai", reply(403))).state, "rejected");
  assert.equal((await checkProviderKey("google", reply(400))).state, "rejected");
  assert.equal((await checkProviderKey("openai", reply(500))).state, "error");
  assert.equal((await checkProviderKey("openai", async () => { throw new Error("offline"); })).state, "error");
});

test("the key goes in a header, never the URL or the result", async () => {
  for (const k of KEYS) process.env[k] = `secret-${k}`;
  const seen = [];
  const results = await checkAllProviderKeys(async (url, init) => (seen.push({ url: String(url), headers: init.headers }), new Response("{}", { status: 401 })));
  assert.equal(results.length, 4);
  for (const { url, headers } of seen) {
    assert.ok(!url.includes("secret-"), url);
    assert.ok(Object.values(headers).some((v) => String(v).includes("secret-")));
  }
  assert.ok(results.every((r) => !JSON.stringify(r).includes("secret-")));
});
