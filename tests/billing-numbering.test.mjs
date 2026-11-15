// Run with: npm test
//
// Migration 20261116000000 in Postgres (PGlite, every migration applied):
// invoice and receipt voucher serials per venue per Indian FY, and the
// company billing address rule.
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

let db;
let venueA;
let venueB;
before(async () => {
  db = await createDatabase();
  const { rows } = await db.query(`select id from public.venues order by id limit 2`);
  [venueA, venueB] = rows.map((r) => r.id);
});

const take = async (fn, venue, on) => (await db.query(`select public.${fn}($1, $2) n`, [venue, on])).rows[0].n;

test("invoice numbers: consecutive per venue per FY, restarting each April", async () => {
  assert.equal(await take("take_venue_invoice_number", venueA, "2026-11-20"), "2026-27/000001");
  assert.equal(await take("take_venue_invoice_number", venueA, "2027-03-31"), "2026-27/000002");
  assert.equal(await take("take_venue_invoice_number", venueB, "2026-11-20"), "2026-27/000001", "each venue has its own series");
  assert.equal(await take("take_venue_invoice_number", venueA, "2027-04-01"), "2027-28/000001", "new FY, new series");
});

test("invoice numbers share the series contract instalments use, so a venue's series stays unbroken", async () => {
  const { rows } = await db.query(`select last_number from invoice_number_series where venue_id = $1 and fiscal_year = '2026-27'`, [venueA]);
  assert.equal(rows[0].last_number, 2, "the same invoice_number_series row booking_invoices draws from");
});

test("receipt vouchers: their own consecutive series per venue per FY", async () => {
  assert.equal(await take("take_receipt_voucher_number", venueA, "2026-11-05"), "RV/2026-27/000001");
  assert.equal(await take("take_receipt_voucher_number", venueA, "2026-11-06"), "RV/2026-27/000002");
  assert.equal(await take("take_venue_invoice_number", venueA, "2026-11-20"), "2026-27/000003", "vouchers don't use invoice numbers");
});

test("only the service role can take numbers; a portal user can't", async () => {
  for (const fn of ["take_venue_invoice_number", "take_receipt_voucher_number"]) {
    await assert.rejects(asUser(db, {}, (tx) => tx.query(`select public.${fn}($1, '2026-11-20')`, [venueA])), /permission denied/, fn);
  }
});

test("billing address: 10–500 characters when set", async () => {
  const { rows } = await db.query(`select id from public.companies limit 1`);
  const id = rows[0].id;
  await db.query(`update public.companies set billing_address = '4th Floor, Prestige Tech Park, Bengaluru 560103' where id = $1`, [id]);
  await assert.rejects(db.query(`update public.companies set billing_address = 'short' where id = $1`, [id]), /check constraint/);
  await db.query(`update public.companies set billing_address = null where id = $1`, [id]);
});
