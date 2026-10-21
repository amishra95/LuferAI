import { mkdirSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test as setup } from "@playwright/test";

import { sessionFile, type SessionRole } from "./support/stream";

/*
 * Saves signed-in sessions for the e2e specs (playwright/.auth/<role>.json,
 * git-ignored). The app signs in by magic link or Google only (no passwords),
 * so instead of typing into /login this mints a one-time magic link for the
 * account with the Supabase admin API and opens the app's own callback with
 * it (/auth/callback?token_hash=…), exactly as clicking the emailed link would.
 *
 * Each role runs only when its email is set; otherwise it's skipped and any
 * session already saved is left alone:
 *   PROPERTY_MANAGER_EMAIL  → property.json  (lands on /property)
 *   ORGANIZER_EMAIL         → buyer.json     (lands on /client)
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the same
 * project as the app under test (playwright.config.ts loads .env.local).
 * Sessions belong to the origin they're saved on (localhost vs a preview URL).
 */

const ROLES: { role: SessionRole; env: string; home: string }[] = [
  { role: "property", env: "PROPERTY_MANAGER_EMAIL", home: "/property" },
  { role: "buyer", env: "ORGANIZER_EMAIL", home: "/client" },
];

for (const { role, env, home } of ROLES) {
  setup(`save the ${role} session`, async ({ page }) => {
    const email = process.env[env]?.trim();
    setup.skip(!email, `${env} not set: keeping any saved ${role} session`);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to mint a sign-in link.");

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: email! });
    if (error) throw new Error(`Couldn't create a sign-in link for ${email}: ${error.message}`);

    await page.goto(`/auth/callback?${new URLSearchParams({ token_hash: data.properties.hashed_token, type: "email", next: home })}`);
    // The callback redirects to /login?error=… when the account has no portal access.
    await page.waitForURL((u) => u.pathname === home || u.pathname === "/login", { timeout: 60_000 });
    const landed = new URL(page.url());
    expect(landed.pathname, `${email} couldn't open ${home} (${landed.searchParams.get("error") ?? "redirected"})`).toBe(home);

    const file = sessionFile(role);
    mkdirSync(path.dirname(file), { recursive: true });
    await page.context().storageState({ path: file });
  });
}
