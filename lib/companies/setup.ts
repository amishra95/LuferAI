import { z } from "zod";

/**
 * A company's first-run setup: where the office is (distance badges and the
 * distance rule) and the per-head approval tiers (the "In policy" badge on
 * venue cards). Pure: tests import it directly.
 */

/** Bengaluru business districts, for picking the office without typing coordinates. */
export const OFFICE_AREAS = [
  { key: "mg-road", label: "MG Road / CBD", latitude: 12.9756, longitude: 77.6066 },
  { key: "indiranagar", label: "Indiranagar", latitude: 12.9719, longitude: 77.6412 },
  { key: "koramangala", label: "Koramangala", latitude: 12.9352, longitude: 77.6245 },
  { key: "hsr-layout", label: "HSR Layout", latitude: 12.9116, longitude: 77.6474 },
  { key: "bellandur", label: "Bellandur / ORR", latitude: 12.9256, longitude: 77.6766 },
  { key: "marathahalli", label: "Marathahalli", latitude: 12.9591, longitude: 77.6974 },
  { key: "whitefield", label: "Whitefield", latitude: 12.9698, longitude: 77.75 },
  { key: "electronic-city", label: "Electronic City", latitude: 12.8452, longitude: 77.6602 },
  { key: "manyata", label: "Hebbal / Manyata", latitude: 13.0473, longitude: 77.6206 },
  { key: "yeshwanthpur", label: "Yeshwanthpur / Malleshwaram", latitude: 13.0108, longitude: 77.5552 },
  { key: "jayanagar", label: "Jayanagar / JP Nagar", latitude: 12.925, longitude: 77.5838 },
] as const;

export type OfficeAreaKey = (typeof OFFICE_AREAS)[number]["key"];

export const officeArea = (key: string) => OFFICE_AREAS.find((a) => a.key === key) ?? null;

/** The preset an office was set from, matched by label; null for none or a custom office. */
export const officeAreaKeyOf = (company: { office_latitude?: unknown; office_label?: string | null }) =>
  company.office_latitude == null ? null : (OFFICE_AREAS.find((a) => a.label === company.office_label)?.key ?? null);

const rupees = z
  .union([z.literal(""), z.coerce.number().int().min(0).max(10_000_000)])
  .transform((v) => (v === "" ? null : v));

export const CompanySetupInput = z
  .object({
    officeArea: z.union([z.literal(""), z.enum(OFFICE_AREAS.map((a) => a.key) as [OfficeAreaKey, ...OfficeAreaKey[]])]),
    autoApprovePerHead: rupees,
    managerPerHead: rupees,
    maxPerHead: rupees,
    maxDistanceKm: z.union([z.literal(""), z.coerce.number().min(0).max(200)]).transform((v) => (v === "" ? null : v)),
  })
  .superRefine((v, ctx) => {
    const order: [keyof typeof v, number | null][] = [
      ["autoApprovePerHead", v.autoApprovePerHead],
      ["managerPerHead", v.managerPerHead],
      ["maxPerHead", v.maxPerHead],
    ];
    const set = order.filter(([, n]) => n != null) as [string, number][];
    for (let i = 1; i < set.length; i++) {
      if (set[i][1] < set[i - 1][1]) {
        ctx.addIssue({ code: "custom", path: [set[i][0]], message: "Each limit must be at least the one before it." });
      }
    }
  });

export type CompanySetupInput = z.input<typeof CompanySetupInput>;
export type CompanySetup = z.output<typeof CompanySetupInput>;

/** What's left to set up, for the checklist on Home. */
export function setupGaps(state: { hasOffice: boolean; approvers: number; hasPerHeadTiers: boolean }) {
  return [
    { key: "office", label: "Set your office area", done: state.hasOffice },
    { key: "approvers", label: "Add an approver", done: state.approvers > 0 },
    { key: "limits", label: "Set per-head approval limits", done: state.hasPerHeadTiers },
  ] as const;
}
