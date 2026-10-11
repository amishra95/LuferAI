import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E suite (tests/*.spec.ts). The unit tests (tests/*.test.mjs) stay on
 * `npm test`; this runs with `npm run test:e2e`.
 *
 * Portal tests sign in with magic-link tokens minted by the Supabase admin API
 * (tests/auth.setup.ts), so they need NEXT_PUBLIC_SUPABASE_URL, the anon key,
 * SUPABASE_SERVICE_ROLE_KEY and the E2E_* accounts in tests/support/e2e.ts.
 * Without them those tests skip and only the signed-out checks run.
 */
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const local = new URL(baseURL).hostname === "localhost";

// Simulates "no AI model configured" for the concierge fallback test. Next
// doesn't override variables already in the environment, so an empty value wins
// over .env.local.
const serverEnv: Record<string, string> = process.env.E2E_SIMULATE_NO_MODEL === "1" ? { OPENAI_API_KEY: "" } : {};

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.(spec|setup)\.ts$/,
  outputDir: "test-results/e2e",
  // Specs share seeded accounts and one event room; parallel workers would race.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    timezoneId: "Asia/Kolkata",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    { name: "chromium", testMatch: /.*\.spec\.ts$/, use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  // Only start a server for localhost; a remote E2E_BASE_URL is tested as is.
  webServer: local
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI && process.env.E2E_SIMULATE_NO_MODEL !== "1",
        timeout: 180_000,
        env: serverEnv,
        stdout: "ignore",
        stderr: "pipe",
      }
    : undefined,
});
