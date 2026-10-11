import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";

import { authFile, emailFor, HOME, hasRole, magicLinkTokenHash, type Role } from "./support/e2e";

const ROLES: Role[] = ["buyer", "buyer2", "partner", "admin"];

/**
 * One signed-in storage state per configured role. Unconfigured roles get an
 * empty state so specs can still reference the file; their tests skip.
 */
for (const role of ROLES) {
  setup(`sign in as ${role}`, async ({ page }) => {
    const file = authFile(role);
    mkdirSync(dirname(file), { recursive: true });
    if (!hasRole(role)) {
      writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
      setup.skip(true, `${role} not configured`);
      return;
    }

    const tokenHash = await magicLinkTokenHash(emailFor(role));
    const params = new URLSearchParams({ token_hash: tokenHash, type: "magiclink", next: HOME[role] });
    await page.goto(`/auth/callback?${params}`);
    // The callback sends unprovisioned users to /login?error=no_access.
    await expect(page, `${role} (${emailFor(role)}) should land in a portal`).not.toHaveURL(/\/login/);
    await page.context().storageState({ path: file });
  });
}
