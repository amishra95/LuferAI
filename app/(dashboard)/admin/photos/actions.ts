"use server";

import { revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { attachVenuePhoto, createPhotoUpload, PhotoError, removeVenuePhoto, setVenueCover, type PhotoTable } from "@/lib/venues/photo-store";
import type { HostFormState } from "../../property/actions";

/**
 * Admin photo uploads for any venue or partner listing. The id the page hands
 * the photo manager names the table: "venue:<uuid>" or "listing:<uuid>".
 */
const TABLES: Record<string, PhotoTable> = { venue: "venues", listing: "partner_venues" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function target(key: string): { table: PhotoTable; id: string } {
  const [kind = "", id = ""] = key.split(":");
  const table = TABLES[kind];
  if (!table || !UUID.test(id)) throw new PhotoError("Unknown venue.");
  return { table, id };
}

async function requireAdmin() {
  const member = await requirePortal("/admin");
  if (member.role !== "ADMIN") throw new PhotoError("Only Lufer admins can change these photos.");
}

function revalidate() {
  revalidatePath("/admin/photos");
  revalidatePath("/venues");
  revalidatePath("/client");
  revalidatePath("/property");
}

function message(action: string, err: unknown): string {
  if (err instanceof PhotoError) return err.message;
  console.error(`admin/photos: ${action}`, err);
  return "That didn't save. Try again.";
}

export async function startAdminPhotoUploadAction(input: { venueId: string; type: string; size: number }): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const { table, id } = target(input.venueId);
    return { ok: true, ...(await createPhotoUpload(id, input, table)) };
  } catch (err) {
    return { ok: false, error: message("start upload", err) };
  }
}

export async function attachAdminPhotoAction(input: { venueId: string; path: string }): Promise<HostFormState> {
  try {
    await requireAdmin();
    const { table, id } = target(input.venueId);
    await attachVenuePhoto(id, input.path, table);
    revalidate();
    return { status: "success", message: "Photo added." };
  } catch (err) {
    return { status: "error", message: message("attach", err) };
  }
}

/** Removes a photo, or makes it the cover (intent=cover). */
export async function updateAdminPhotoAction(formData: FormData) {
  await requireAdmin();
  const { table, id } = target(String(formData.get("venue_id") ?? ""));
  const ref = String(formData.get("photo") ?? "");
  if (!ref) throw new Error("Invalid photo update");
  if (formData.get("intent") === "cover") await setVenueCover(id, ref, table);
  else await removeVenuePhoto(id, ref, table);
  revalidate();
}
