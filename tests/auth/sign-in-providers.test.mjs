// Run with: npm test
//
// lib/supabase/providers.ts: the login page only shows "Continue with Google"
// and "Continue with company SSO" when Supabase Auth has them switched on.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { signInProviders } from "../../lib/supabase/providers.ts";

const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("signInProviders", () => {
  before(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  test("email only: neither Google nor SSO", async () => {
    assert.deepEqual(await signInProviders(json({ external: { email: true, google: false }, saml_enabled: false })), { google: false, sso: false });
  });

  test("Google and SAML enabled", async () => {
    assert.deepEqual(await signInProviders(json({ external: { email: true, google: true }, saml_enabled: true })), { google: true, sso: true });
  });

  test("reads /auth/v1/settings with the anon key", async () => {
    let seen;
    await signInProviders(async (url, init) => {
      seen = { url: String(url), apikey: init.headers.apikey };
      return new Response("{}");
    });
    assert.deepEqual(seen, { url: "https://example.supabase.co/auth/v1/settings", apikey: "anon" });
  });

  test("fails closed on an error response, bad JSON or a network failure", async () => {
    assert.deepEqual(await signInProviders(json({ external: { google: true } }, 500)), { google: false, sso: false });
    assert.deepEqual(await signInProviders(async () => new Response("not json")), { google: false, sso: false });
    assert.deepEqual(
      await signInProviders(async () => {
        throw new Error("offline");
      }),
      { google: false, sso: false }
    );
  });

  test("nothing extra when Supabase isn't configured", async () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    try {
      let called = false;
      assert.deepEqual(
        await signInProviders(async () => {
          called = true;
          return new Response("{}");
        }),
        { google: false, sso: false }
      );
      assert.equal(called, false);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  });
});
