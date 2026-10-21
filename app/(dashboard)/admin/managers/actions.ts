"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { parseManagerInput, type ManagerField } from "@/lib/admin/property-manager-input";
import { addPropertyManager, assignVenue, ManagerError, setManagerActive } from "@/lib/admin/property-managers";
import { requirePortal } from "@/lib/auth/session";
import { siteUrl } from "@/lib/site-url";

export interface ManagerFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<ManagerField, string>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** Admins only (the /admin portal); every action re-checks. */
async function run(fn: () => Promise<string>): Promise<ManagerFormState> {
  const member = await requirePortal("/admin");
  if (member.role !== "ADMIN") return { status: "error", message: "Only platform admins manage property users." };
  try {
    const message = await fn();
    revalidatePath("/admin/managers");
    revalidatePath("/property");
    return { status: "success", message };
  } catch (err) {
    if (err instanceof ManagerError) return { status: "error", message: err.message, ...(err.field && { fieldErrors: { [err.field]: err.message } }) };
    console.error("admin/managers:", err);
    return { status: "error", message: "That didn't work. Try again." };
  }
}

export async function addManagerAction(_prev: ManagerFormState, form: FormData): Promise<ManagerFormState> {
  const parsed = parseManagerInput({ email: str(form, "email"), name: str(form, "name"), phone: str(form, "phone"), venue_id: str(form, "venue_id") });
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors, message: "Please fix the highlighted fields." };
  return run(async () => {
    const h = await headers();
    const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    const redirectTo = new URL("/auth/callback?next=/property", siteUrl(origin)).toString();
    const { invited } = await addPropertyManager(parsed.value, redirectTo);
    return invited
      ? `Invitation sent to ${parsed.value.email}. They'll see the venue's requests once they accept.`
      : `${parsed.value.email} already had an account and now manages this venue.`;
  });
}

export async function assignVenueAction(_prev: ManagerFormState, form: FormData): Promise<ManagerFormState> {
  const userId = str(form, "user_id");
  const venueId = str(form, "venue_id");
  if (!UUID.test(userId) || !UUID.test(venueId)) return { status: "error", message: "Choose a venue." };
  return run(async () => {
    await assignVenue(userId, venueId);
    return "Venue updated. They see its requests from their next page load.";
  });
}

export async function setActiveAction(_prev: ManagerFormState, form: FormData): Promise<ManagerFormState> {
  const userId = str(form, "user_id");
  const active = str(form, "active") === "true";
  if (!UUID.test(userId)) return { status: "error", message: "Unknown user." };
  return run(async () => {
    await setManagerActive(userId, active);
    return active ? "Reactivated: they can sign in again." : "Deactivated: they can't sign in (an open session ends within the hour).";
  });
}
