import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPhotoUpload, isVenuePhotoPath, MAX_PHOTO_BYTES, MAX_PHOTOS, photoUrl, photoUrls, sniffPhotoType, withCover } from "../lib/venues/photos.ts";

const VENUE = "aaaaaaaa-0001-4000-8000-000000000001";
const FILE = "0b4e7a52-3f0e-4c1a-9d8e-1f2a3b4c5d6e";
const SUPABASE = "https://abc.supabase.co/";

test("checkPhotoUpload accepts JPEG, PNG and WebP up to 5 MB and the photo limit", () => {
  assert.deepEqual(checkPhotoUpload({ type: "image/jpeg", size: 1000 }, 0), { ok: true, type: "image/jpeg", ext: "jpg" });
  assert.deepEqual(checkPhotoUpload({ type: "image/webp", size: MAX_PHOTO_BYTES }, MAX_PHOTOS - 1), { ok: true, type: "image/webp", ext: "webp" });
  assert.equal(checkPhotoUpload({ type: "image/gif", size: 1000 }, 0).ok, false);
  assert.equal(checkPhotoUpload({ type: "image/svg+xml", size: 1000 }, 0).ok, false);
  assert.equal(checkPhotoUpload({ type: "image/png", size: MAX_PHOTO_BYTES + 1 }, 0).ok, false);
  assert.equal(checkPhotoUpload({ type: "image/png", size: 0 }, 0).ok, false);
  assert.match(checkPhotoUpload({ type: "image/png", size: 10 }, MAX_PHOTOS).error, /up to 8 photos/);
});

test("sniffPhotoType reads the file's signature, not its name", () => {
  assert.equal(sniffPhotoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(sniffPhotoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  assert.equal(sniffPhotoType(webp), "image/webp");
  assert.equal(sniffPhotoType(new TextEncoder().encode("<svg xmlns=")), null);
  assert.equal(sniffPhotoType(new TextEncoder().encode("RIFF\0\0\0\0WAVE")), null);
  assert.equal(sniffPhotoType(new Uint8Array([])), null);
});

test("isVenuePhotoPath only accepts this venue's upload slots", () => {
  assert.equal(isVenuePhotoPath(VENUE, `${VENUE}/${FILE}.jpg`), true);
  assert.equal(isVenuePhotoPath(VENUE, `${VENUE}/${FILE}.svg`), false);
  assert.equal(isVenuePhotoPath(VENUE, `aaaaaaaa-0002-4000-8000-000000000002/${FILE}.jpg`), false);
  assert.equal(isVenuePhotoPath(VENUE, `${VENUE}/../other/${FILE}.jpg`), false);
  assert.equal(isVenuePhotoPath(VENUE, `${VENUE}/nested/${FILE}.jpg`), false);
  assert.equal(isVenuePhotoPath(VENUE, `${VENUE}/cover.jpg`), false);
});

test("photoUrl builds public Storage URLs and passes https URLs through", () => {
  assert.equal(photoUrl(`${VENUE}/${FILE}.jpg`, SUPABASE), `https://abc.supabase.co/storage/v1/object/public/venue-photos/${VENUE}/${FILE}.jpg`);
  assert.equal(photoUrl("https://cdn.example.com/a.jpg", SUPABASE), "https://cdn.example.com/a.jpg");
  assert.equal(photoUrl("http://cdn.example.com/a.jpg", SUPABASE), null);
  assert.equal(photoUrl("javascript:alert(1)", SUPABASE), null);
  assert.equal(photoUrl("../secret", SUPABASE), null);
  assert.equal(photoUrl("/abs", SUPABASE), null);
  assert.equal(photoUrl(`${VENUE}/${FILE}.jpg`, ""), null);
  assert.deepEqual(photoUrls(undefined, SUPABASE), []);
  assert.deepEqual(photoUrls(["../x", "https://a.example/b.png"], SUPABASE), ["https://a.example/b.png"]);
});

test("withCover moves a photo to the front and ignores unknown ones", () => {
  assert.deepEqual(withCover(["a", "b", "c"], "c"), ["c", "a", "b"]);
  assert.deepEqual(withCover(["a", "b"], "a"), ["a", "b"]);
  assert.deepEqual(withCover(["a", "b"], "z"), ["a", "b"]);
});

test("migration: venues.photos defaults to none and holds at most 8", async () => {
  const { createDatabase } = await import("./support/supabase-pglite.mjs");
  const db = await createDatabase();
  const { rows } = await db.query(`select photos from venues where id = $1`, [VENUE]);
  assert.deepEqual(rows[0].photos, []);
  const eight = Array.from({ length: 8 }, (_, i) => `${VENUE}/${FILE.slice(0, -1)}${i}.jpg`);
  await db.query(`update venues set photos = $2 where id = $1`, [VENUE, eight]);
  await assert.rejects(db.query(`update venues set photos = $2 where id = $1`, [VENUE, [...eight, "https://a.example/9.jpg"]]), /venues_photos_max/);
});
