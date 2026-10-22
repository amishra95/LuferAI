// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { cachedSpatialQuery, hubFor, SPATIAL_CACHE_TTL_SECONDS, spatialCacheKey } from "../lib/cache/spatial-cache.ts";
import { formatOfficeDistance } from "../lib/venues/discovery.ts";
import { fetchNearbyVenues, parseSpatialQuery, searchNearbyVenues, SpatialQueryError } from "../lib/venues/spatial.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const BKC = { latitude: 19.0657, longitude: 72.8686 };
const MG_ROAD = { latitude: 12.9716, longitude: 77.5946 };
const DELHI = { latitude: 28.6304, longitude: 77.2177 };

const row = (id, meters) => ({ venue_id: id, name: id, neighborhood: "BKC", city: "Mumbai", latitude: "19.066", longitude: "72.869", distance_meters: String(meters) });

/** RPC client fake that records calls. */
function fakeDb(rows, error = null) {
  const calls = [];
  return { calls, rpc: async (fn, args) => (calls.push({ fn, args }), { data: error ? null : rows, error }) };
}

/** Redis fake: a Map, optionally failing reads or writes. */
function fakeCache({ failGet = false, failSet = false } = {}) {
  const store = new Map();
  const sets = [];
  return {
    store,
    sets,
    get: async (key) => {
      if (failGet) throw new Error("redis down");
      return store.get(key) ?? null;
    },
    set: async (key, value, opts) => {
      if (failSet) throw new Error("redis down");
      sets.push({ key, opts });
      store.set(key, value);
    },
  };
}

// --- query validation and RPC mapping ---------------------------------------

test("parseSpatialQuery accepts numeric strings and rejects bad coordinates or radius", () => {
  assert.deepEqual(parseSpatialQuery({ latitude: "19.0657", longitude: 72.8686, radiusMeters: "5000" }), { ...BKC, radiusMeters: 5000 });
  assert.throws(() => parseSpatialQuery({ latitude: 91, longitude: 0, radiusMeters: 1 }), SpatialQueryError);
  assert.throws(() => parseSpatialQuery({ latitude: 0, longitude: -181, radiusMeters: 1 }), SpatialQueryError);
  assert.throws(() => parseSpatialQuery({ latitude: 0, longitude: 0, radiusMeters: 0 }), SpatialQueryError);
  assert.throws(() => parseSpatialQuery({ latitude: 0, longitude: 0, radiusMeters: 200_001 }), SpatialQueryError);
  assert.throws(() => parseSpatialQuery({ latitude: "abc", longitude: 0, radiusMeters: 1 }), SpatialQueryError);
});

test("fetchNearbyVenues passes the RPC args and coerces numeric columns", async () => {
  const db = fakeDb([row("a", "120.5")]);
  const venues = await fetchNearbyVenues(db, { ...BKC, radiusMeters: 5000 });
  assert.deepEqual(db.calls, [{ fn: "nearby_venues_within_radius", args: { client_lat: 19.0657, client_lng: 72.8686, radius_meters: 5000 } }]);
  assert.deepEqual(venues, [{ id: "a", name: "a", neighborhood: "BKC", city: "Mumbai", latitude: 19.066, longitude: 72.869, distanceMeters: 120.5 }]);
});

test("fetchNearbyVenues surfaces RPC errors", async () => {
  await assert.rejects(fetchNearbyVenues(fakeDb(null, { message: "function does not exist" }), { ...BKC, radiusMeters: 1 }), /function does not exist/);
});

// --- hub cache -----------------------------------------------------------------

test("hubFor matches points inside a hub's catchment only", () => {
  assert.equal(hubFor(BKC), "BKC");
  assert.equal(hubFor({ latitude: 17.45, longitude: 78.38 }), "Hitec City");
  assert.equal(hubFor({ latitude: 12.978, longitude: 77.64 }), "Indiranagar");
  assert.equal(hubFor(DELHI), null);
});

test("cache key rounds to ~1 m so the same office always hits", () => {
  assert.equal(spatialCacheKey({ latitude: 19.065700001, longitude: 72.8686 }, 5000.2), "spatial:venues:19.06570,72.86860:5000");
});

test("hub query: miss loads from the DB and caches for 300 s; the repeat is served from cache", async () => {
  const cache = fakeCache();
  const db = fakeDb([row("a", 100)]);
  const q = { ...BKC, radiusMeters: 5000 };
  const first = await searchNearbyVenues({ db, cache }, q);
  const second = await searchNearbyVenues({ db, cache }, q);
  assert.equal(first.source, "db");
  assert.equal(second.source, "cache");
  assert.deepEqual(second.venues, first.venues);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(cache.sets, [{ key: spatialCacheKey(BKC, 5000), opts: { ex: SPATIAL_CACHE_TTL_SECONDS } }]);
  assert.equal(SPATIAL_CACHE_TTL_SECONDS, 300);
});

test("query outside every hub skips the cache", async () => {
  const cache = fakeCache();
  const db = fakeDb([]);
  const r = await searchNearbyVenues({ db, cache }, { ...DELHI, radiusMeters: 5000 });
  assert.equal(r.source, "db");
  assert.equal(cache.sets.length, 0);
});

test("no Redis configured: straight to the DB", async () => {
  const r = await searchNearbyVenues({ db: fakeDb([row("a", 1)]), cache: null }, { ...BKC, radiusMeters: 5000 });
  assert.equal(r.source, "db");
  assert.equal(r.venues.length, 1);
});

test("Redis read failure falls back to the DB", async () => {
  const db = fakeDb([row("a", 1)]);
  const r = await searchNearbyVenues({ db, cache: fakeCache({ failGet: true }) }, { ...BKC, radiusMeters: 5000 });
  assert.equal(r.source, "db");
  assert.equal(r.venues[0].id, "a");
  assert.equal(db.calls.length, 1);
});

test("Redis write failure still returns the DB result", async () => {
  const r = await searchNearbyVenues({ db: fakeDb([row("a", 1)]), cache: fakeCache({ failSet: true }) }, { ...BKC, radiusMeters: 5000 });
  assert.equal(r.venues[0].id, "a");
});

test("a DB failure is not masked by the cache", async () => {
  await assert.rejects(cachedSpatialQuery(fakeCache(), BKC, 5000, async () => { throw new Error("db down"); }), /db down/);
});

test("formatOfficeDistance labels a known distance and hides out-of-town ones", () => {
  assert.equal(formatOfficeDistance({ label: "HQ" }, 1.8), "1.8 km from HQ");
  assert.equal(formatOfficeDistance({ label: "HQ" }, 0.163), "150 m from HQ");
  assert.equal(formatOfficeDistance({ label: "HQ" }, 51), null);
});

// --- PostGIS migration and RPC, against PGlite with every migration applied ----

let db;
before(async () => {
  db = await createDatabase();
});

const nearby = async (point, radius) =>
  (await db.query("select venue_id, distance_meters from nearby_venues_within_radius($1, $2, $3)", [point.latitude, point.longitude, radius])).rows;

test("venues.location is generated from latitude/longitude", async () => {
  const { rows } = await db.query("select count(*)::int n, count(location)::int located from venues where latitude is not null");
  assert.ok(rows[0].n > 0);
  assert.equal(rows[0].located, rows[0].n);
});

test("RPC returns active venues within the radius, nearest first, with distances in metres", async () => {
  const rows = await nearby(MG_ROAD, 50_000);
  assert.ok(rows.length > 0);
  const d = rows.map((r) => r.distance_meters);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
  assert.ok(d.every((m) => m <= 50_000));

  const tight = await nearby(MG_ROAD, d[0] + 1);
  assert.deepEqual(tight.map((r) => r.venue_id), [rows[0].venue_id]);
  assert.deepEqual(await nearby(DELHI, 10_000), []);
});

test("RPC skips inactive venues and venues without coordinates", async () => {
  const [first] = await nearby(MG_ROAD, 50_000);
  await db.query("begin");
  try {
    await db.query("update venues set is_active = false where id = $1", [first.venue_id]);
    assert.ok(!(await nearby(MG_ROAD, 50_000)).some((r) => r.venue_id === first.venue_id));
    await db.query("update venues set is_active = true, latitude = null, longitude = null where id = $1", [first.venue_id]);
    assert.ok(!(await nearby(MG_ROAD, 50_000)).some((r) => r.venue_id === first.venue_id));
  } finally {
    await db.query("rollback");
  }
});

test("RPC is callable by signed-in users, not anon", async () => {
  const call = (q) => q.query("select * from nearby_venues_within_radius(12.97, 77.59, 1000)");
  await asUser(db, { role: "authenticated", claims: { sub: "00000000-0000-4000-8000-000000000000" } }, call);
  await assert.rejects(asUser(db, { role: "anon" }, call), /permission denied/);
});

test("spatial search uses the GiST index and answers well under 15 ms on ~9k venues", async () => {
  await db.query("begin");
  try {
    await db.exec(`
      insert into venues (name, city, neighborhood, address, gstin, capacity_max, latitude, longitude)
      select 'Bulk ' || i, 'X', 'Y', 'Z', g14 || public.gstin_checksum(g14), 50,
             8 + (i * 7919 % 2000) / 100.0, 70 + (i * 104729 % 2000) / 100.0
      from generate_series(1, 9000) i, lateral (select '29AAAAA' || lpad(i::text, 4, '0') || 'A1Z' as g14) g;
      analyze venues;`);
    // The function's body (SET search_path stops it being inlined, so explain the query itself).
    const plan = (
      await db.query(`explain
        with origin as (select extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326)::extensions.geography g)
        select v.id from venues v, origin
        where v.is_active and v.location is not null and extensions.st_dwithin(v.location, origin.g, 50000)
        order by v.location operator(extensions.<->) origin.g limit 100`)
    ).rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.match(plan, /idx_venues_location_gist/);

    await nearby(MG_ROAD, 50_000); // warm
    const times = [];
    for (let i = 0; i < 21; i++) {
      const t = performance.now();
      await nearby(MG_ROAD, 50_000);
      times.push(performance.now() - t);
    }
    const median = times.sort((a, b) => a - b)[10];
    assert.ok(median < 15, `median ${median.toFixed(2)} ms`);
  } finally {
    await db.query("rollback");
  }
});
