#!/usr/bin/env node
/**
 * Removes seed and e2e test data from the linked Supabase project
 * (supabase/scripts/purge-demo-data.sql explains exactly what goes).
 *
 *   node scripts/purge-demo-data.mjs            # dry run: prints what would be deleted, changes nothing
 *   node scripts/purge-demo-data.mjs --apply    # deletes it
 *
 * Runs through `supabase db query --linked`, so it targets whichever project
 * `npx supabase link` points at. Check that first: `npx supabase projects list`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apply = process.argv.includes("--apply");
const script = readFileSync(new URL("../supabase/scripts/purge-demo-data.sql", import.meta.url), "utf8");
const sql = `${apply ? "select set_config('purge.apply', 'on', false);\n" : ""}${script}`;

const dir = mkdtempSync(join(tmpdir(), "purge-"));
const file = join(dir, "purge.sql");
writeFileSync(file, sql);
const run = spawnSync("npx", ["--no-install", "supabase", "db", "query", "--linked", "-f", file], { encoding: "utf8" });
rmSync(dir, { recursive: true, force: true });

// The CLI prints the report JSON-escaped.
const output = `${run.stdout}\n${run.stderr}`.replaceAll("\\\\n", "\n").replaceAll("\\n", "\n");
const report = output.match(/(?:DRY RUN, nothing was changed\. )?Deleted:[\s\S]*?Real accounts kept: \d+/)?.[0];

if (!apply && output.includes("DRY RUN")) {
  console.log(report ?? output);
  console.log("\nRe-run with --apply to delete.");
  process.exit(0);
}
if (run.status !== 0 || output.includes("purge aborted") || /ERROR/i.test(output)) {
  console.error(output);
  process.exit(1);
}
console.log(report ?? output);
console.log("\nDone.");
