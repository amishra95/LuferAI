/**
 * Public origin of this deployment: NEXT_PUBLIC_SITE_URL when set, else the
 * Vercel deployment URL (previews), else the caller's request-derived origin.
 */
export function siteUrl(fallback: string) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return fallback;
}
