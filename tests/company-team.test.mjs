import assert from "node:assert/strict";
import test from "node:test";

import { inviteMessage, removalRefusal, roleLabel, TeamInvite } from "../lib/companies/team.ts";

test("invites take a normalised work email and a corporate role", () => {
  assert.deepEqual(TeamInvite.parse({ email: "  Priya@Acme.IN ", role: "ORGANIZER" }), { email: "priya@acme.in", role: "ORGANIZER" });
  assert.equal(TeamInvite.safeParse({ email: "nope", role: "ORGANIZER" }).success, false);
  assert.equal(TeamInvite.safeParse({ email: "a@b.in", role: "ADMIN" }).success, false);
});

test("removal: never yourself, never the last Approver, only your team", () => {
  const team = [
    { id: "me", role: "APPROVER" },
    { id: "org", role: "ORGANIZER" },
  ];
  assert.equal(removalRefusal("me", team[0], team), "You can't remove yourself.");
  assert.equal(removalRefusal("me", team[1], team), null);
  assert.equal(removalRefusal("me", { id: "x", role: "ORGANIZER" }, team), "They're not on your team.");
  const twoApprovers = [...team, { id: "a2", role: "APPROVER" }];
  assert.equal(removalRefusal("me", twoApprovers[2], twoApprovers), null);
  const otherIsOnlyApprover = [{ id: "me", role: "ORGANIZER" }, { id: "a", role: "APPROVER" }];
  assert.equal(removalRefusal("me", otherIsOnlyApprover[1], otherIsOnlyApprover), "Your company needs at least one Approver.");
});

test("invite email names the inviter, company, role and sign-in link", () => {
  const m = inviteMessage({ companyName: "Nack", inviterEmail: "silva@nack.in", role: "APPROVER", signInUrl: "https://lufer.app/login?email=x%40nack.in" });
  assert.equal(m.subject, "Join Nack on Lufer");
  assert.match(m.text, /silva@nack\.in added you to Nack on Lufer as an Approver\./);
  assert.match(m.text, /https:\/\/lufer\.app\/login\?email=x%40nack\.in/);
  assert.equal(roleLabel("FINANCE_VIEWER"), "Finance viewer");
});
