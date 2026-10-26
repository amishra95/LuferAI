/**
 * Response security headers for every route (applied in next.config.ts).
 *
 * Two Content-Security-Policies:
 * - Enforced: only directives that can't break a page — no framing (clickjacking),
 *   no <base> hijack, no plugins.
 * - Report-only: the full allow-list (Supabase REST + Realtime, MapTiler, Razorpay
 *   Checkout, Vercel Analytics). Violations are POSTed to /api/csp-report and logged,
 *   so the list can be tuned from real traffic before it is enforced. To enforce it,
 *   move `reportOnlyPolicy` into the Content-Security-Policy header.
 *
 * Generated documents (tax invoices, signed contracts) get DOCUMENT_POLICY instead: next.config
 * headers override a route handler's own headers, so that policy is applied there too.
 *
 * Scripts need 'unsafe-inline' because Next.js inlines its bootstrap scripts; dropping
 * it means nonces, which forces every page to render dynamically.
 *
 * No server-only imports or path aliases, so tests can import it directly
 * (tests/security-headers.test.mjs).
 */

export interface SecurityHeaderOptions {
  /** NEXT_PUBLIC_SUPABASE_URL: REST/Auth/Storage over https, Realtime over wss. */
  supabaseUrl?: string;
  /** `next dev`: allows eval (React Refresh) and the HMR websocket, and skips HSTS. */
  dev?: boolean;
}

export const CSP_REPORT_PATH = "/api/csp-report";

/** Static HTML we generated: nothing in it should run, load, submit or be framed. */
export const DOCUMENT_POLICY = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Routes that serve generated documents, as next.config `headers()` sources. */
export const DOCUMENT_ROUTES = ["/api/bookings/:id/tax-invoice", "/api/contracts/:id/document"];

const RAZORPAY = ["https://checkout.razorpay.com", "https://api.razorpay.com"];

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
}

function policy(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

export function enforcedPolicy(): string {
  return policy({
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  });
}

export function reportOnlyPolicy({ supabaseUrl, dev = false }: SecurityHeaderOptions = {}): string {
  const supabase = originOf(supabaseUrl);
  const supabaseWs = supabase?.replace(/^http/, "ws");
  return policy({
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'", "https://va.vercel-scripts.com"] : []), "https://checkout.razorpay.com"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase] : []),
      ...(supabaseWs ? [supabaseWs] : []),
      "https://api.maptiler.com",
      ...RAZORPAY,
      "https://lumberjack.razorpay.com",
      ...(dev ? ["ws:", "https://va.vercel-scripts.com"] : []),
    ],
    // maplibre-gl decodes tiles in a blob: worker.
    "worker-src": ["'self'", "blob:"],
    "frame-src": RAZORPAY,
    "form-action": ["'self'", ...RAZORPAY],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
  });
}

export function securityHeaders(options: SecurityHeaderOptions = {}): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: enforcedPolicy() },
    { key: "Content-Security-Policy-Report-Only", value: reportOnlyPolicy(options) },
    // Two years; no `preload`, which is hard to undo once submitted.
    ...(options.dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Clipboard (copy buttons) needs no permission here; Razorpay may use the Payment Request API.
    { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com")' },
  ];
}
