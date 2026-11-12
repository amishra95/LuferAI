import "server-only";

import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { clean } from "@/lib/supabase/env";
import { checkPhotoUpload, isVenuePhotoPath, PHOTO_BUCKET, photoUrls, sniffPhotoType, withCover } from "@/lib/venues/photos";

/** A host-facing reason a photo change was refused. */
export class PhotoError extends Error {}

const supabaseUrl = () => clean(process.env.NEXT_PUBLIC_SUPABASE_URL);

/** The venue's photos as URLs, cover first. */
export const venuePhotoUrls = (photos: readonly string[] | null | undefined) => photoUrls(photos, supabaseUrl());

/**
 * Where the photos live: a venue (hosts and admins) or a partner listing such
 * as a Lufer Concierge venue (admins). Both keep paths in the same bucket,
 * foldered by row id; ids are UUIDs, so the folders never collide.
 */
export type PhotoTable = "venues" | "partner_venues";

async function readPhotos(venueId: string, table: PhotoTable): Promise<string[]> {
  const { data, error } = await createAdminClient().from(table).select("photos").eq("id", venueId).single();
  if (error) throw error;
  return data.photos ?? [];
}

async function writePhotos(venueId: string, photos: string[], table: PhotoTable) {
  const { error } = await createAdminClient().from(table).update({ photos }).eq("id", venueId);
  if (error) throw error;
}

/**
 * A one-time upload slot for the host's browser: the file goes straight to
 * Storage (no 4.5 MB function body limit), then attachVenuePhoto checks it.
 */
export async function createPhotoUpload(venueId: string, file: { type: string; size: number }, table: PhotoTable = "venues"): Promise<{ path: string; token: string }> {
  const check = checkPhotoUpload(file, (await readPhotos(venueId, table)).length);
  if (!check.ok) throw new PhotoError(check.error);
  const path = `${venueId}/${randomUUID()}.${check.ext}`;
  const { data, error } = await createAdminClient().storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { path, token: data.token };
}

/** Adds an uploaded file to the venue once its bytes prove it's an image; anything else is deleted. */
export async function attachVenuePhoto(venueId: string, path: string, table: PhotoTable = "venues"): Promise<string[]> {
  if (!isVenuePhotoPath(venueId, path)) throw new PhotoError("That upload doesn't belong to this venue.");
  const bucket = createAdminClient().storage.from(PHOTO_BUCKET);
  const { data: blob, error } = await bucket.download(path);
  if (error || !blob) throw new PhotoError("The upload didn't finish. Try again.");
  const type = sniffPhotoType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
  const check = type ? checkPhotoUpload({ type, size: blob.size }, 0) : null;
  const photos = await readPhotos(venueId, table);
  if (!check?.ok || photos.length >= 8 || !path.endsWith(`.${check.ext}`)) {
    await bucket.remove([path]);
    throw new PhotoError(check && !check.ok ? check.error : photos.length >= 8 ? "A venue can have up to 8 photos. Remove one first." : "That file isn't a JPEG, PNG or WebP image.");
  }
  const next = photos.includes(path) ? photos : [...photos, path];
  await writePhotos(venueId, next, table);
  return next;
}

export async function removeVenuePhoto(venueId: string, ref: string, table: PhotoTable = "venues"): Promise<void> {
  const photos = await readPhotos(venueId, table);
  if (!photos.includes(ref)) return;
  await writePhotos(venueId, photos.filter((p) => p !== ref), table);
  if (isVenuePhotoPath(venueId, ref)) {
    const { error } = await createAdminClient().storage.from(PHOTO_BUCKET).remove([ref]);
    if (error) console.error("venue photos: could not delete object", ref, error);
  }
}

export async function setVenueCover(venueId: string, ref: string, table: PhotoTable = "venues"): Promise<void> {
  await writePhotos(venueId, withCover(await readPhotos(venueId, table), ref), table);
}
