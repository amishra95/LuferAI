import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONCIERGE_PARTNER, conciergePhotoRefs, conciergePhotoUrl } from "../lib/venues/concierge-photos.ts";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));

test("concierge listings with a photo on file get its public URL", () => {
  assert.equal(conciergePhotoUrl(CONCIERGE_PARTNER, "LUF-001"), "/venues/concierge/LUF-001.jpg");
});

test("no photo for listings without one, or from other partners", () => {
  assert.equal(conciergePhotoUrl(CONCIERGE_PARTNER, "LUF-999"), null);
  assert.equal(conciergePhotoUrl("Some Venue Partner", "LUF-001"), null);
});

test("every mapped photo exists in public/venues/concierge", () => {
  for (const ref of conciergePhotoRefs()) {
    assert.ok(existsSync(`${publicDir}/venues/concierge/${ref}.jpg`), `missing public/venues/concierge/${ref}.jpg`);
  }
});
