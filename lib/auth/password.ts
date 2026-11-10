/** Shared by /signup and /password. Pure: tests/auth/password.test.mjs imports it directly. */
export const PASSWORD_MIN = 8;

/** Why a new password won't do, or null. 8 characters minimum; at most 72 bytes (bcrypt ignores the rest). */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > 72) return "That's too long. Use at most 72 characters.";
  return null;
}
