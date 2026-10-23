// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Twilio's webhook signature (lib/channels/signatures.ts). Meta's is covered
// in tests/channels.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { verifyTwilioSignature } from "../../lib/channels/signatures.ts";

const URL_ = "https://lufer.example/api/webhooks/whatsapp";
const TOKEN = "twilio-auth-token";
const params = () => new URLSearchParams({ MessageSid: "SM123", From: "whatsapp:+919845012345", To: "whatsapp:+14155238886", ButtonPayload: "apv1:x", ButtonText: "Approve" });

/** Twilio's algorithm, written out independently: URL, then each name+value sorted by name. */
function sign(url, p, token) {
  const data = url + [...p.keys()].sort().map((k) => k + p.get(k)).join("");
  return createHmac("sha1", token).update(data).digest("base64");
}

test("Twilio's documented example signature verifies", () => {
  // From Twilio's "Webhooks security" guide.
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const p = new URLSearchParams({ CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" });
  assert.equal(verifyTwilioSignature(url, p, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", "12345"), true);
});

test("a correct signature verifies, whatever order the fields arrive in", () => {
  const sig = sign(URL_, params(), TOKEN);
  assert.equal(verifyTwilioSignature(URL_, params(), sig, TOKEN), true);
  const reordered = new URLSearchParams([...params().entries()].reverse());
  assert.equal(verifyTwilioSignature(URL_, reordered, sig, TOKEN), true);
});

test("a changed, added or removed field fails", () => {
  const sig = sign(URL_, params(), TOKEN);
  const changed = params();
  changed.set("ButtonPayload", "apv1:y");
  const added = params();
  added.set("Extra", "1");
  const removed = params();
  removed.delete("ButtonText");
  for (const p of [changed, added, removed]) assert.equal(verifyTwilioSignature(URL_, p, sig, TOKEN), false);
});

test("a different URL, token, or a missing header or token fails", () => {
  const sig = sign(URL_, params(), TOKEN);
  assert.equal(verifyTwilioSignature(`${URL_}?x=1`, params(), sig, TOKEN), false);
  assert.equal(verifyTwilioSignature(URL_.replace("https", "http"), params(), sig, TOKEN), false);
  assert.equal(verifyTwilioSignature(URL_, params(), sig, "other-token"), false);
  assert.equal(verifyTwilioSignature(URL_, params(), null, TOKEN), false);
  assert.equal(verifyTwilioSignature(URL_, params(), sig, ""), false);
  assert.equal(verifyTwilioSignature("", params(), sig, TOKEN), false);
});
