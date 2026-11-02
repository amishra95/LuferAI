#!/usr/bin/env node
/**
 * Points preview deployments and local dev at their own Supabase project, so
 * nothing but production touches production data.
 *
 *   STAGING_DB_PASSWORD=… node scripts/setup-staging.mjs --ref <staging-ref> [--accounts-from <backup.json>] [--skip-vercel]
 *
 * 1. Applies every migration and supabase/seed.sql to the staging project.
 * 2. Pushes auth settings: the custom access token hook the app's roles depend on,
 *    and redirect URLs for preview deployments and localhost. Google sign-in stays
 *    off there (magic links only), as previews can't complete Google OAuth.
 * 3. With --accounts-from, recreates the test logins found in a backup made before
 *    the purge (*.example and @lufer.test, with the same roles, companies and
 *    partners), so the e2e suite and demo logins keep working on previews.
 * 4. Sets NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for the
 *    Vercel Preview and Development environments. Production is never changed.
 *
 * Runs in a temporary copy of supabase/, so the repo's linked project (production)
 * is untouched. Refuses to run against the production ref.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

const ROOT = new URL("../", import.meta.url).pathname;
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const ref = arg("--ref");
const accountsFrom = arg("--accounts-from");
const password = process.env.STAGING_DB_PASSWORD;
const TEST_EMAIL = /(\.example|@lufer\.test)$/i;
const PREVIEW_REDIRECTS = ["https://*-lufer2.vercel.app/**", "http://localhost:3000/**", "http://127.0.0.1:3000/**"];

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function run(cmd, cmdArgs, { input, quiet } = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", input, stdio: [input ? "pipe" : "inherit", quiet ? "pipe" : "inherit", "pipe"] });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.slice(0, 3).join(" ")} failed:\n${r.stderr}`);
  return r.stdout ?? "";
}

if (!ref || !/^[a-z0-9]{20}$/.test(ref)) fail("--ref <staging project ref> is required (20 lowercase letters/digits).");
if (!password) fail("Set STAGING_DB_PASSWORD to the staging database password.");
const prodRef = (() => {
  try {
    return readFileSync(join(ROOT, "supabase/.temp/project-ref"), "utf8").trim();
  } catch {
    return null;
  }
})();
if (ref === prodRef) fail("That's the production project (the repo's linked ref). Pass the staging project's ref.");

// --- 1 & 2: migrations, seed, auth config, in a throwaway workdir --------------------
const work = mkdtempSync(join(tmpdir(), "lufer-staging-"));
try {
  for (const p of ["config.toml", "migrations", "seed.sql", "templates"]) cpSync(join(ROOT, "supabase", p), join(work, "supabase", p), { recursive: true });
  let config = readFileSync(join(work, "supabase/config.toml"), "utf8");
  config = config
    .replace(/^site_url = .*$/m, `site_url = "http://localhost:3000"`)
    .replace(/^additional_redirect_urls = .*$/m, `additional_redirect_urls = ${JSON.stringify(PREVIEW_REDIRECTS)}`)
    .replace(/(\[auth\.external\.google\]\s*\nenabled = )true/, "$1false");
  writeFileSync(join(work, "supabase/config.toml"), config);

  console.log(`→ Linking a temporary workdir to ${ref} (production stays linked in the repo)`);
  run("npx", ["--no-install", "supabase", "link", "--workdir", work, "--project-ref", ref, "--password", password, "--yes"]);
  console.log("→ Applying migrations and seed data");
  run("npx", ["--no-install", "supabase", "db", "push", "--workdir", work, "--include-seed", "--password", password, "--yes"]);
  console.log("→ Pushing auth settings (access token hook, preview redirect URLs)");
  run("npx", ["--no-install", "supabase", "config", "push", "--workdir", work, "--project-ref", ref, "--yes"]);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// --- keys ---------------------------------------------------------------------------
const keys = JSON.parse(run("npx", ["--no-install", "supabase", "projects", "api-keys", "--project-ref", ref, "--reveal", "-o", "json"], { quiet: true }));
const keyOf = (name) => keys.find((k) => k.name === name)?.api_key;
const url = `https://${ref}.supabase.co`;
const anonKey = keyOf("anon");
const serviceKey = keyOf("service_role");
if (!anonKey || !serviceKey) fail("Couldn't read the staging anon / service_role keys.");

// --- 3: test logins -----------------------------------------------------------------
if (accountsFrom) {
  const backup = JSON.parse(readFileSync(accountsFrom, "utf8"));
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const testUsers = backup.auth_users.filter((u) => TEST_EMAIL.test(u.email ?? ""));
  const members = backup.tables.platform_users ?? [];
  const partners = new Map((backup.tables.partners ?? []).map((p) => [p.id, p]));
  console.log(`→ Recreating ${testUsers.length} test login(s)`);
  for (const u of testUsers) {
    const member = members.find((m) => m.user_id === u.id);
    if (member?.partner_id && partners.has(member.partner_id)) {
      const { error } = await db.from("partners").upsert(partners.get(member.partner_id));
      if (error) fail(`partner for ${u.email}: ${error.message}`);
      partners.delete(member.partner_id);
    }
    const { data, error } = await db.auth.admin.createUser({ email: u.email, email_confirm: true });
    if (error && !/already/i.test(error.message)) fail(`${u.email}: ${error.message}`);
    const userId = data?.user?.id ?? (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((x) => x.email === u.email)?.id;
    if (member && userId) {
      const { error: memberError } = await db.from("platform_users").upsert({ ...member, user_id: userId });
      if (memberError) fail(`membership for ${u.email}: ${memberError.message}`);
    }
    console.log(`  ✓ ${u.email}${member ? ` (${member.role})` : ""}`);
  }
}

// --- 4: Vercel Preview + Development ------------------------------------------------
if (!args.includes("--skip-vercel")) {
  console.log("→ Pointing Vercel Preview and Development at staging (Production unchanged)");
  for (const environment of ["preview", "development"]) {
    for (const [name, value, sensitive] of [
      ["NEXT_PUBLIC_SUPABASE_URL", url, false],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey, false],
      ["SUPABASE_SERVICE_ROLE_KEY", serviceKey, true],
    ]) {
      run("npx", ["--yes", "vercel@latest", "env", "add", name, environment, "--value", value, "--force", "--yes", ...(sensitive && environment === "preview" ? ["--sensitive"] : [])], { quiet: true });
      console.log(`  ✓ ${environment} ${name}`);
    }
  }
}

console.log(`\nDone. Staging: ${url}
Next:
  - Redeploy a preview so it picks up the new variables.
  - Local dev: replace the three Supabase lines in .env.local with the staging values
    (don't \`vercel env pull\` over it: that drops the local-only E2E_* settings).
  - Re-save e2e sessions for the new project (e2e/auth.setup.ts).
  - Then purge production: node scripts/purge-demo-data.mjs --apply`);
