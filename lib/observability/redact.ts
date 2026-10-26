/**
 * URL scrubbing shared by the server error log (error-report.ts), the CSP report
 * endpoint and Sentry (sentry.ts, which also runs in the browser).
 *
 * No imports, so it is safe in every runtime and tests can import it directly.
 */

/** Path segments that are bearer secrets: guest RSVP links (/rsvp/<token>) and vendor quote links (/quote/<token>). */
const TOKEN_PATH = /^\/(rsvp|quote)\/[^/]+/;

/** Drops query strings (OAuth codes and the like) and masks token path segments. */
export function safePath(path: string): string {
  const i = path.indexOf("?");
  return (i === -1 ? path : path.slice(0, i)).replace(TOKEN_PATH, "/$1/[token]");
}

/** Same for an absolute URL: keeps the origin, scrubs path, drops query and fragment. Relative input is treated as a path. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${safePath(u.pathname)}`;
  } catch {
    return safePath(url.split("#")[0]);
  }
}

const TOKEN_IN_TEXT = /(\/(?:rsvp|quote)\/)[^/?#\s"']+/g;
// A path or URL followed by a query string: "/x?code=…", "https://h/x?code=…".
const QUERY_IN_TEXT = /((?:https?:\/\/[^\s/?#"']+)?\/[^\s?#"']*)\?[^\s#"']*/g;

/** Scrubs URLs and paths anywhere inside free text: masks tokens, drops query strings. */
export function scrubText(text: string): string {
  if (!text.includes("/")) return text;
  return text.replace(TOKEN_IN_TEXT, "$1[token]").replace(QUERY_IN_TEXT, "$1");
}

/**
 * Keys dropped wherever they appear: bare query strings (no "?" for scrubText to find),
 * cookies and client IPs. Span attributes carry url.query and user.ip_address even with
 * Sentry's sendDefaultPii off.
 */
const DROP_KEYS = new Set(["url.query", "http.query", "query_string", "cookies", "user.ip_address", "client.address", "ip_address", "http.client_ip"]);

/**
 * Applies scrubText to every string in a JSON-like value and removes DROP_KEYS, in place
 * (objects) or by return (strings).
 */
export function scrubDeep<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (value === null || typeof value !== "object" || depth > 12 || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrubDeep(value[i], depth + 1, seen);
  } else {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (DROP_KEYS.has(key)) delete record[key];
      else record[key] = scrubDeep(record[key], depth + 1, seen);
    }
  }
  return value;
}
