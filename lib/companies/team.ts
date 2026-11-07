import { z } from "zod";

/**
 * A company's own team: Approvers invite colleagues by email, who join the
 * company at once (no Lufer review), and can remove them again. Pure: tests
 * import it directly; lib/companies/team-store.ts does the writes.
 */

export const TEAM_ROLES = [
  { value: "ORGANIZER", label: "Organizer" },
  { value: "APPROVER", label: "Approver" },
  { value: "FINANCE_VIEWER", label: "Finance viewer" },
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number]["value"];

export const roleLabel = (role: string | null) => TEAM_ROLES.find((r) => r.value === role)?.label ?? "Member";

export const TeamInvite = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a work email.")
    .max(254),
  role: z.enum(["ORGANIZER", "APPROVER", "FINANCE_VIEWER"]),
});

export type TeamInvite = z.output<typeof TeamInvite>;

/**
 * Why `actorId` may not remove `targetId`, or null if they may. Nobody removes
 * themselves, and a company always keeps one Approver (who runs its setup).
 */
export function removalRefusal(actorId: string, target: { id: string; role: string | null }, team: readonly { id: string; role: string | null }[]): string | null {
  if (target.id === actorId) return "You can't remove yourself.";
  if (!team.some((m) => m.id === target.id)) return "They're not on your team.";
  if (target.role === "APPROVER" && team.filter((m) => m.role === "APPROVER").length <= 1) return "Your company needs at least one Approver.";
  return null;
}

/** The invite email: who invited them, to which company, and where to sign in. */
export function inviteMessage(input: { companyName: string; inviterEmail: string; role: TeamRole; signInUrl: string }) {
  const role = roleLabel(input.role);
  const subject = `Join ${input.companyName} on Lufer`;
  const lines = [
    `${input.inviterEmail} added you to ${input.companyName} on Lufer as ${/^[AEIOU]/.test(role) ? "an" : "a"} ${role}.`,
    "",
    "Sign in with this email address to plan and book team events:",
    input.signInUrl,
    "",
    "— Lufer",
  ];
  return { subject, text: lines.join("\n"), lines };
}
