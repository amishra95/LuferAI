import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// The app's own env (.env.local etc.): e2e/auth.setup.ts mints sessions for the same Supabase project.
loadEnvConfig(process.cwd());

/**
 * End-to-end tests (e2e/*.spec.ts) in Chromium and WebKit.
 *
 * Target: E2E_BASE_URL (e.g. a preview deployment), else a local server on
 * :3000, started with `npm run dev` unless one is already running.
 *
 * Sign-in: the workspace pages need a Supabase session. Tests load saved
 * sessions from playwright/.auth/<role>.json (git-ignored; E2E_AUTH_DIR to
 * point elsewhere) and skip when the file is missing. Sessions are bound to
 * the origin they were saved on, so a preview URL needs its own. The "setup"
 * project (e2e/auth.setup.ts) saves them first when PROPERTY_MANAGER_EMAIL /
 * ORGANIZER_EMAIL are set, and skips otherwise. Specs pick their session
 * (signInAs, or a context per role), so there's no project-wide storageState.
 *
 * The model is never called: specs stream scripted responses in place of
 * /api/chat and /api/agents/stream (e2e/support/stream.ts).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, dependencies: ["setup"] },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 180_000 },
});
