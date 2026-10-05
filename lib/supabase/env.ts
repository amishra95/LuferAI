/**
 * Strips all whitespace from a Supabase env value. URLs and keys never contain
 * whitespace, but values pasted into a dashboard can pick up stray newlines,
 * which make fetch reject the auth header (and echo the key into the error).
 * Takes the value rather than the name so NEXT_PUBLIC_* stays statically
 * referenced at the call site and still gets inlined into the browser bundle.
 */
export function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, "");
}

/** True for an absolute http(s) URL — guards against e.g. a key pasted into the URL slot. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
