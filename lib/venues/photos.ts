/**
 * Venue photos: what a host may upload and how a stored photo becomes a URL.
 *
 * `venues.photos` holds Storage object paths in the public `venue-photos`
 * bucket ("<venue id>/<uuid>.jpg"), cover first; absolute https URLs are kept
 * as-is (seeds, imports). Paths rather than URLs, so a project move or a
 * staging copy doesn't strand every photo. Pure: tests import it directly
 * (tests/venue-photos.test.mjs).
 */

export const PHOTO_BUCKET = "venue-photos";
export const MAX_PHOTOS = 8;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type PhotoType = keyof typeof PHOTO_TYPES;

export type PhotoCheck = { ok: true; type: PhotoType; ext: string } | { ok: false; error: string };

/** The declared type and size of a file the host picked, before any upload. */
export function checkPhotoUpload(file: { type: string; size: number }, existing: number): PhotoCheck {
  if (existing >= MAX_PHOTOS) return { ok: false, error: `A venue can have up to ${MAX_PHOTOS} photos. Remove one first.` };
  if (!(file.type in PHOTO_TYPES)) return { ok: false, error: "Upload a JPEG, PNG or WebP image." };
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "Photos can be up to 5 MB." };
  const type = file.type as PhotoType;
  return { ok: true, type, ext: PHOTO_TYPES[type] };
}

/** The image type from the file's first bytes, or null: the declared type is the browser's guess, this is the file. */
export function sniffPhotoType(bytes: Uint8Array): PhotoType | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, j) => bytes[i + j] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** True when `path` is an upload slot for this venue: "<venue id>/<uuid>.<ext>", nothing else. */
export function isVenuePhotoPath(venueId: string, path: string): boolean {
  const [folder, file, ...rest] = path.split("/");
  return rest.length === 0 && folder === venueId && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file ?? "");
}

/** Public URL for a stored photo; absolute https URLs pass through, anything else is dropped. */
export function photoUrl(ref: string, supabaseUrl: string): string | null {
  if (/^https:\/\//.test(ref)) return ref;
  const base = supabaseUrl.replace(/\/+$/, "");
  if (!base || ref.includes(":") || ref.startsWith("/") || ref.includes("..")) return null;
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${ref.split("/").map(encodeURIComponent).join("/")}`;
}

/** The venue's photos as URLs, cover first. Tolerates rows saved before the column existed. */
export function photoUrls(photos: readonly string[] | null | undefined, supabaseUrl: string): string[] {
  return (photos ?? []).map((p) => photoUrl(p, supabaseUrl)).filter((u): u is string => u !== null);
}

/** Moves `ref` to the front (the cover); unchanged when it isn't one of the photos. */
export function withCover(photos: readonly string[], ref: string): string[] {
  return photos.includes(ref) ? [ref, ...photos.filter((p) => p !== ref)] : [...photos];
}
