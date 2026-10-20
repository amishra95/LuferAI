/**
 * Concierge memory (migration 0032) on PGlite with pgvector: preferences and
 * episodic memories are private to their user, recall ranks by similarity, and
 * a revoked membership loses access.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const ALICE = "c0000000-0000-4000-8000-000000000001";
const BOB = "c0000000-0000-4000-8000-000000000002";

/** A 768-d unit vector pointing mostly along `axis`. */
const vec = (axis, tilt = 0) => {
  const v = Array(768).fill(0);
  v[axis] = 1;
  v[(axis + 1) % 768] = tilt;
  return JSON.stringify(v);
};

let db;

before(async () => {
  db = await createDatabase();
  await db.query(`insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'bob@example.test')`, [ALICE, BOB]);
  await db.query(
    `insert into platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $3, 'ORGANIZER'), ($2, 'CLIENT', $4, 'ORGANIZER')`,
    [ALICE, BOB, NIMBUS, VERTEX]
  );
});

const as = (user, fn) => asUser(db, { claims: { sub: user } }, fn);

test("users write and read only their own preferences", async () => {
  await as(ALICE, async (tx) => {
    await tx.query(`insert into user_preferences (user_id, dietary, cuisines, budget_limit_per_head_inr) values ($1, '{jain}', '{south indian}', 2500)`, [ALICE]);
    const { rows } = await tx.query(`select dietary, budget_limit_per_head_inr from user_preferences`);
    assert.deepEqual(rows, [{ dietary: ["jain"], budget_limit_per_head_inr: "2500.00" }]);
    await assert.rejects(tx.query(`insert into user_preferences (user_id) values ($1)`, [BOB]), /row-level security/);
  });
});

test("recall ranks the caller's memories by similarity and never returns another user's", async () => {
  await db.query(
    `insert into booking_memories (user_id, kind, summary, embedding) values
       ($1, 'booking', 'Rooftop dinner at Toit', $3), ($1, 'feedback', 'Team disliked loud music', $4), ($2, 'note', 'Bob prefers Hebbal', $3)`,
    [ALICE, BOB, vec(0), vec(5)]
  );
  const alice = await as(ALICE, (tx) => tx.query(`select summary, similarity from match_booking_memories($1, 5)`, [vec(0, 0.1)]));
  assert.deepEqual(alice.rows.map((r) => r.summary), ["Rooftop dinner at Toit", "Team disliked loud music"]);
  assert.ok(alice.rows[0].similarity > 0.9);

  const bob = await as(BOB, (tx) => tx.query(`select summary from booking_memories`));
  assert.deepEqual(bob.rows.map((r) => r.summary), ["Bob prefers Hebbal"]);
});

test("a memory can't point at a booking the user can't see", async () => {
  const other = (await db.query(`select id from bookings where company_id = $1 limit 1`, [VERTEX])).rows[0].id;
  const own = (await db.query(`select id from bookings where company_id = $1 limit 1`, [NIMBUS])).rows[0].id;
  await as(ALICE, async (tx) => {
    await tx.query(`insert into booking_memories (user_id, booking_id, summary, embedding) values ($1, $2, 'ok', $3)`, [ALICE, own, vec(1)]);
    await assert.rejects(
      tx.query(`insert into booking_memories (user_id, booking_id, summary, embedding) values ($1, $2, 'nope', $3)`, [ALICE, other, vec(1)]),
      /row-level security/
    );
  });
});

test("removing the membership revokes access to memory at once", async () => {
  await db.query(`delete from platform_users where user_id = $1`, [BOB]);
  const n = await as(BOB, async (tx) => Number((await tx.query(`select count(*) n from booking_memories`)).rows[0].n));
  assert.equal(n, 0);
});
