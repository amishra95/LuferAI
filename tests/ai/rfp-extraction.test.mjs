// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// The RFP broadcast route (app/api/ai/rfp-broadcast) when the model's answer
// isn't a usable RFP: not JSON, or JSON that doesn't fit RfpRequirements.
// Both are the brief's problem (422 "couldn't read that brief"), not an outage
// (502). Gemini's API is stubbed; Supabase points at a local stand-in that
// accepts the run and usage logs, since the route needs the live database.
import { signIn } from "../support/server-actions.mjs";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const { POST } = await import("../../app/api/ai/rfp-broadcast/route.ts");

let geminiText = "";
let server;
const realFetch = globalThis.fetch;
before(async () => {
  // Any Supabase request: accepted, nothing returned.
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(req.method === "GET" ? 200 : 201, { "content-type": "application/json" });
      res.end("[]");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://generativelanguage.googleapis.com/")) return realFetch(input, init);
    return Response.json({
      candidates: [{ content: { role: "model", parts: [{ text: geminiText }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
    });
  };
});
after(() => {
  globalThis.fetch = realFetch;
  server.close();
  for (const k of ["GOOGLE_GENERATIVE_AI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[k];
  signIn(null);
});
beforeEach(() => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-gemini-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  signIn({ role: "CLIENT", userId: "dddddddd-0001-4000-8000-000000000001", companyId: "11111111-1111-4111-8111-111111111111", corporateRole: "ORGANIZER" });
});

const broadcast = () =>
  POST(
    new Request("https://lufer.test/api/ai/rfp-broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "Team dinner for our engineers sometime soon, somewhere nice." }),
    })
  );

test("a model answer that isn't JSON is 422, not 502", async () => {
  geminiText = "I need more details about the event before I can help.";
  const res = await broadcast();
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error, "Couldn't read that brief — add the guest count and date.");
});

test("JSON that doesn't fit the RFP schema is 422 too", async () => {
  geminiText = JSON.stringify({ party_size: "lots", city: 42 });
  assert.equal((await broadcast()).status, 422);
});
