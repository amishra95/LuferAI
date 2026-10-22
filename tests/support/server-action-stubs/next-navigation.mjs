/** redirect() as Next throws it, so a test can tell a redirect from a failure. */
export function redirect(url) {
  throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url}` });
}
export function notFound() {
  throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
}
export function unstable_rethrow(err) {
  if (typeof err?.digest === "string" && /^NEXT_(REDIRECT|HTTP_ERROR_FALLBACK)/.test(err.digest)) throw err;
}
