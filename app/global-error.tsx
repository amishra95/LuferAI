"use client";

import { useEffect } from "react";

/**
 * Last-resort fallback when the root layout itself fails. It replaces the whole document,
 * so it can't rely on the app's layout, fonts or components. The digest matches the
 * `server_error` log line (instrumentation.ts).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("root layout failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, padding: 16 }}>
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: "#555" }}>{error.digest ? `Please try again. If it keeps happening, quote ref ${error.digest}.` : "Please try again."}</p>
          <button type="button" onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", background: "white", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
