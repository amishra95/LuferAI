// The signed-in member is whatever the test set with signIn() (tests/support/server-actions.mjs).
export const getCurrentMember = async () => globalThis.__testMember ?? null;
export async function requirePortal() {
  const member = await getCurrentMember();
  if (!member) throw Object.assign(new Error("NEXT_REDIRECT /login"), { digest: "NEXT_REDIRECT;replace;/login" });
  return member;
}
export const requireWorkspace = requirePortal;
export class PartnerAccessError extends Error {}
export async function requirePartner() {
  throw new PartnerAccessError("Partner access isn't stubbed in tests.");
}
