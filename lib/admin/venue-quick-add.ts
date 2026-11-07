import { z } from "zod";

import { officeArea, OFFICE_AREAS, type OfficeAreaKey } from "../companies/setup.ts";
import { normalizeGstin, validateGstin } from "../gst-engine.ts";
import { DIETARY_TAGS } from "../quotes.ts";

/**
 * Lufer admins list a venue they signed offline in one form: the venue, up to
 * three per-head packages and, optionally, its manager. With a valid GSTIN it
 * goes live at once; without one it's saved unlisted (publishing needs a GSTIN).
 * Pure: tests import it; lib/admin/venue-quick-add-store.ts does the writes.
 */

const optionalInr = z
  .union([z.literal(""), z.coerce.number().int().min(0).max(100_000_000)])
  .transform((v) => (v === "" ? 0 : v));

export const QuickAddPackage = z.object({
  name: z.string().trim().max(80),
  perHead: z.union([z.literal(""), z.coerce.number().positive().max(100_000)]),
  dietary: z.array(z.enum(DIETARY_TAGS)).default([]),
});

export const VenueQuickAdd = z
  .object({
    name: z.string().trim().min(2, "Enter the venue's name.").max(120),
    area: z.enum(OFFICE_AREAS.map((a) => a.key) as [OfficeAreaKey, ...OfficeAreaKey[]], { message: "Pick an area." }),
    address: z.string().trim().min(5, "Enter the street address.").max(240),
    capacity: z.coerce.number().int("Whole guests only.").min(2, "At least 2 guests.").max(5000),
    privateRoom: z.boolean(),
    servesAlcohol: z.boolean(),
    minSpend: optionalInr,
    gstin: z.string().trim().max(20).transform((v) => (v ? normalizeGstin(v) : "")),
    packages: z.array(QuickAddPackage).max(3),
    managerEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email for the manager.")]),
    managerName: z.string().trim().max(80),
  })
  .superRefine((v, ctx) => {
    if (v.gstin) {
      const check = validateGstin(v.gstin);
      if (!check.valid) ctx.addIssue({ code: "custom", path: ["gstin"], message: check.reason ?? "Invalid GSTIN." });
    }
    v.packages.forEach((p, i) => {
      const named = p.name.length > 0;
      const priced = p.perHead !== "";
      if (named !== priced) ctx.addIssue({ code: "custom", path: ["packages", i], message: `Package ${i + 1}: give both a name and a per-head price.` });
    });
    if (v.managerEmail && !v.managerName) ctx.addIssue({ code: "custom", path: ["managerName"], message: "Enter the manager's name." });
  })
  .transform((v) => {
    const area = officeArea(v.area)!;
    return {
      ...v,
      neighborhood: area.label.split(" / ")[0],
      latitude: area.latitude,
      longitude: area.longitude,
      packages: v.packages.filter((p) => p.name).map((p) => ({ name: p.name, perHead: Number(p.perHead), dietary: p.dietary })),
      // Live straight away only with a GSTIN (the same rule as Publish).
      publish: Boolean(v.gstin),
    };
  });

export type VenueQuickAddInput = z.input<typeof VenueQuickAdd>;
export type VenueQuickAddValue = z.output<typeof VenueQuickAdd>;
