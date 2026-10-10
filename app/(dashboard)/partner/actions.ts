"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isPartnerRole, type PartnerPermission } from "@/lib/auth/partner-rbac";
import { PartnerAccessError, requirePartner, type PartnerContext } from "@/lib/auth/session";
import {
  changeMember,
  createListing,
  deleteListing,
  deleteRateCard,
  inviteMember,
  PartnerError,
  recordAudit,
  saveRateCard,
  setListingStatus,
  updateListing,
} from "@/lib/partner/service";
import { fieldErrorsOf, listingSchema, rateCardSchema } from "@/lib/partner/validation";
import { siteUrl } from "@/lib/site-url";
import { publishVenueUpdated } from "@/lib/telemetry/live";
import type { VenueChange } from "@/lib/telemetry/events";

export interface PartnerFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/**
 * Every partner action: authorise (requirePartner with the action's permission;
 * admins name the partner in the form), run, revalidate, and turn expected
 * failures into form state. Unexpected errors are logged and reported generically.
 */
async function run(
  form: FormData,
  permission: PartnerPermission,
  fn: (ctx: PartnerContext) => Promise<string>
): Promise<PartnerFormState> {
  try {
    const ctx = await requirePartner(permission, str(form, "partner_id") || null);
    const message = await fn(ctx);
    revalidatePath("/partner");
    return { status: "success", message };
  } catch (err) {
    if (err instanceof PartnerAccessError) return { status: "error", message: err.message };
    if (err instanceof PartnerError) return { status: "error", message: err.message, fieldErrors: err.field ? { [err.field]: err.message } : undefined };
    if (err instanceof Validation) return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: err.fieldErrors };
    // Next's redirect() (from requirePortal) must propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error(`partner: ${permission} failed`, err);
    return { status: "error", message: "Something went wrong. Try again." };
  }
}

class Validation extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>) {
    super("validation");
    this.fieldErrors = fieldErrors;
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new Validation(fieldErrorsOf(r.error) as Record<string, string>);
  return r.data;
}

const uuid = (value: string) => {
  if (!z.uuid().safeParse(value).success) throw new PartnerError("Invalid request.");
  return value;
};

// ----------------------------------------------------------------------------
// Listings
// ----------------------------------------------------------------------------

/** Listings appear in the venue directory as `extranet:<id>`: refresh it and tell live views. */
async function listingChanged(listingId: string, change: VenueChange) {
  revalidatePath("/venues");
  await publishVenueUpdated(`extranet:${listingId}`, change);
}

/** Create (no id) or edit a listing. Owners and Managers. */
export async function saveListingAction(_prev: PartnerFormState, form: FormData): Promise<PartnerFormState> {
  return run(form, "listing.edit", async ({ member, partnerId }) => {
    const input = parse(listingSchema, {
      ref: str(form, "ref"),
      name: str(form, "name"),
      area: str(form, "area"),
      city: str(form, "city") || "Bengaluru",
      address: str(form, "address"),
      capacity: str(form, "capacity"),
      min_spend_inr: str(form, "min_spend_inr") || "0",
      private_dining: form.get("private_dining") === "on",
    });
    const id = str(form, "id");
    const listing = id ? await updateListing(partnerId, uuid(id), input) : await createListing(partnerId, input);
    await recordAudit({ partnerId, actorId: member.userId, action: id ? "listing.updated" : "listing.created", entity: "listing", entityId: listing.id, detail: { ref: listing.ref, name: listing.name } });
    await listingChanged(listing.id, "saved");
    return id ? `Saved ${listing.name}.` : `Added ${listing.name}.`;
  });
}

/** Pause or resume a listing. Every partner role, including Staff. */
export async function setListingStatusAction(_prev: PartnerFormState, form: FormData): Promise<PartnerFormState> {
  return run(form, "listing.status", async ({ member, partnerId }) => {
    const status = str(form, "status");
    if (status !== "active" && status !== "paused") throw new PartnerError("Invalid status.");
    const listing = await setListingStatus(partnerId, uuid(str(form, "id")), status);
    await recordAudit({ partnerId, actorId: member.userId, action: status === "paused" ? "listing.paused" : "listing.resumed", entity: "listing", entityId: listing.id, detail: { name: listing.name } });
    await listingChanged(listing.id, status === "paused" ? "unpublished" : "published");
    return status === "paused" ? `${listing.name} is paused and hidden from search.` : `${listing.name} is live again.`;
  });
}

export async function deleteListingAction(_prev: PartnerFormState, form: FormData): Promise<PartnerFormState> {
  return run(form, "listing.edit", async ({ member, partnerId }) => {
    const listing = await deleteListing(partnerId, uuid(str(form, "id")));
    await recordAudit({ partnerId, actorId: member.userId, action: "listing.deleted", entity: "listing", entityId: listing.id, detail: { ref: listing.ref, name: listing.name } });
    await listingChanged(listing.id, "deleted");
    return `Deleted ${listing.name} and its rate cards.`;
  });
}

// ----------------------------------------------------------------------------
// Rate cards
// ----------------------------------------------------------------------------

export async function saveRateCardAction(_prev: PartnerFormState, form: FormData): Promise<PartnerFormState> {
  return run(form, "rates.edit", async ({ member, partnerId }) => {
    const input = parse(rateCardSchema, {
      partner_venue_id: str(form, "partner_venue_id"),
      label: str(form, "label"),
      per_head_inr: str(form, "per_head_inr"),
      min_guests: str(form, "min_guests") || "1",
      valid_from: str(form, "valid_from"),
      valid_to: str(form, "valid_to") || null,
    });
    const id = str(form, "id");
    const card = await saveRateCard(partnerId, member.userId, input, id ? uuid(id) : undefined);
    await recordAudit({
      partnerId,
      actorId: member.userId,
      action: id ? "rate_card.updated" : "rate_card.created",
      entity: "rate_card",
      entityId: card.id,
      detail: { label: card.label, per_head_inr: card.per_head_inr, min_guests: card.min_guests, valid_from: card.valid_from, valid_to: card.valid_to },
    });
    return `Saved rate "${card.label}".`;
  });
}

export async function deleteRateCardAction(_prev: PartnerFormState, form: FormData): Promise<PartnerFormState> {
  return run(form, "rates.edit", async ({ member, partnerId }) => {
    const card = await deleteRateCard(partnerId, uuid(str(form, "id")));
    await recordAudit({ partnerId, actorId: member.userId, action: "rate_card.deleted", entity: "rate_card", entityId: card.id, detail: { label: card.label } });
    return `Deleted rate "${card.label}".`;
  });
}

// ----------------------------------------------------------------------------
// Team (Owners only)
// ----------------------------------------------------------------------------

export async function inviteMemberAction(_prev: PartnerFormState, form: FormData): Promise<PartnerFormState> {
  return run(form, "team.manage", async ({ member, partnerId }) => {
    const email = str(form, "email").toLowerCase();
    if (!z.email().safeParse(email).success) throw new PartnerError("Enter a valid email address.", "email");
    const role = str(form, "partner_role");
    if (!isPartnerRole(role)) throw new PartnerError("Choose a role.", "partner_role");

    const h = await headers();
    const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    const redirectTo = new URL("/auth/callback?next=/partner", siteUrl(origin)).toString();
    const { userId, invited } = await inviteMember(partnerId, email, role, redirectTo);
    await recordAudit({ partnerId, actorId: member.userId, action: "member.added", entity: "member", entityId: userId, detail: { email, partner_role: role, invited } });
    return invited ? `Invitation sent to ${email}.` : `${email} already had an account and can now sign in to this partner.`;
  });
}

/** Change a teammate's role, or remove them (role = "REMOVE"). */
export async function changeMemberAction(_prev: PartnerFormState, form: FormData): Promise<PartnerFormState> {
  return run(form, "team.manage", async ({ member, partnerId }) => {
    const userId = uuid(str(form, "user_id"));
    const role = str(form, "partner_role");
    const nextRole = role === "REMOVE" ? null : isPartnerRole(role) ? role : undefined;
    if (nextRole === undefined) throw new PartnerError("Choose a role.");
    const changed = await changeMember(partnerId, userId, nextRole);
    await recordAudit({
      partnerId,
      actorId: member.userId,
      action: nextRole ? "member.role_changed" : "member.removed",
      entity: "member",
      entityId: userId,
      detail: { email: changed.email, from: changed.partnerRole, to: nextRole },
    });
    return nextRole ? `${changed.email} is now ${nextRole.toLowerCase()}.` : `Removed ${changed.email}.`;
  });
}
