import { existsSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Scripted streaming for e2e: replaces the browser's fetch for the given API
 * paths with a response whose body the test writes chunk by chunk, so each
 * intermediate UI state (submitted, tool running, tool done, writing) can be
 * asserted. Nothing reaches the model, and no tool runs on the server.
 */

type StreamState = {
  requests: { path: string; url: string; body: string | null }[];
  streams: Record<string, { push(s: string): void; close(): void }>;
};

declare global {
  interface Window {
    __e2e?: StreamState;
  }
}

export async function mockStreams(page: Page, paths: string[]) {
  await page.addInitScript((mocked: string[]) => {
    const state: StreamState = { requests: [], streams: {} };
    window.__e2e = state;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const pathname = new URL(url, location.href).pathname;
      if (!mocked.includes(pathname)) return realFetch(input, init);
      state.requests.push({ path: pathname, url, body: typeof init?.body === "string" ? init.body : null });
      const encoder = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
      state.streams[pathname] = {
        push: (s) => controller.enqueue(encoder.encode(s)),
        close: () => {
          try {
            controller.close();
          } catch {
            // The client already cancelled it (e.g. after an error chunk).
          }
        },
      };
      init?.signal?.addEventListener("abort", () => {
        try {
          controller.error(new DOMException("Aborted", "AbortError"));
        } catch {
          // Already closed.
        }
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
    };
  }, paths);
}

/** Requests the page made to mocked paths so far. */
export const mockedRequests = (page: Page) => page.evaluate(() => window.__e2e?.requests ?? []);

/** Writes SSE frames (`data: <json>`) to the open stream for `path`. */
export async function sendFrames(page: Page, path: string, ...frames: unknown[]) {
  const text = frames.map((f) => `data: ${typeof f === "string" ? f : JSON.stringify(f)}\n\n`).join("");
  await page.evaluate(([p, t]) => window.__e2e!.streams[p]!.push(t), [path, text] as const);
}

export async function closeStream(page: Page, path: string) {
  await page.evaluate((p) => window.__e2e!.streams[p]!.close(), path);
}

export type SessionRole = "admin" | "buyer" | "property";

/** Where `role`'s saved session lives (playwright/.auth/<role>.json, or E2E_AUTH_DIR). */
export const sessionFile = (role: SessionRole) => path.join(process.env.E2E_AUTH_DIR ?? "playwright/.auth", `${role}.json`);

/** A saved session for `role`, or the test is skipped (see playwright.config.ts). */
export function signInAs(role: SessionRole) {
  const file = sessionFile(role);
  const missing = !existsSync(file);
  test.skip(missing, `No saved ${role} session at ${file}`);
  if (!missing) test.use({ storageState: file });
}

/** Skips when the saved session no longer signs in (the app redirected to /login). */
export function skipIfSignedOut(page: Page) {
  test.skip(new URL(page.url()).pathname === "/login", "Saved session expired: sign in again and re-save it");
}

/**
 * Types into a field and submits. Retries the typing until the submit button
 * enables: text typed before React hydrates never reaches component state.
 */
export async function typeAndSubmit(input: Locator, text: string, submit: Locator) {
  await expect(async () => {
    await input.fill(text);
    await expect(submit).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await submit.click();
}
