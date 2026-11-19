/**
 * The company's booking rules as one form (Policies → Rules): every rule the
 * booking check (evaluate-booking-policy.ts) enforces, presets to start from,
 * and plain sentences for showing the rules back. Pure, so the client and
 * tests can use it.
 */
import { z } from "zod";

import { EVENT_TYPES, type EventType } from "./evaluate-booking-policy.ts";

export const ALCOHOL_CHOICES = { allowed: "Allowed", approval: "Needs approval", prohibited: "Not allowed" } as const;
export type AlcoholChoice = keyof typeof ALCOHOL_CHOICES;

/** Entertainment a booking can include (bookings.entertainment). */
export const ENTERTAINMENT = { live_music: "Live music", dj: "DJ", karaoke: "Karaoke", comedy: "Comedy", games: "Games" } as const;
export type Entertainment = keyof typeof ENTERTAINMENT;

/** What the form edits. Money is pre-GST rupees; null = no limit. */
export interface PolicyRules {
  autoPerHead: number | null;
  managerPerHead: number | null;
  maxPerHead: number | null;
  approvalAbove: number | null;
  seniorAbove: number | null;
  /** 0 = no monthly limit (companies.monthly_spend_limit_inr). */
  monthlyLimit: number;
  maxDistanceKm: number | null;
  alcohol: AlcoholChoice;
  weekdayAlcohol: AlcoholChoice;
  /** "HH:MM", both or neither. */
  hoursStart: string | null;
  hoursEnd: string | null;
  entertainment: Entertainment[];
  eventTypes: EventType[];
}

export const NO_RULES: PolicyRules = {
  autoPerHead: null,
  managerPerHead: null,
  maxPerHead: null,
  approvalAbove: null,
  seniorAbove: null,
  monthlyLimit: 0,
  maxDistanceKm: null,
  alcohol: "allowed",
  weekdayAlcohol: "allowed",
  hoursStart: null,
  hoursEnd: null,
  entertainment: [],
  eventTypes: [],
};

/** Starting points a company picks, then adjusts. */
export const PRESETS = {
  relaxed: {
    label: "Relaxed",
    rules: { ...NO_RULES, autoPerHead: 3500, managerPerHead: 6000, approvalAbove: 200000, seniorAbove: 500000 },
  },
  standard: {
    label: "Standard",
    rules: {
      ...NO_RULES,
      autoPerHead: 2500,
      managerPerHead: 4000,
      approvalAbove: 100000,
      seniorAbove: 300000,
      maxDistanceKm: 25,
      alcohol: "approval",
      weekdayAlcohol: "approval",
      hoursStart: "12:00",
      hoursEnd: "23:00",
    },
  },
  strict: {
    label: "Strict",
    rules: {
      ...NO_RULES,
      autoPerHead: 1500,
      managerPerHead: 2500,
      maxPerHead: 4000,
      approvalAbove: 50000,
      seniorAbove: 150000,
      maxDistanceKm: 15,
      alcohol: "approval",
      weekdayAlcohol: "prohibited",
      hoursStart: "12:00",
      hoursEnd: "22:00",
      entertainment: ["dj", "karaoke"],
      eventTypes: ["celebration"],
    },
  },
} as const satisfies Record<string, { label: string; rules: PolicyRules }>;
export type PresetKey = keyof typeof PRESETS;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** The preset these rules equal exactly, if any (to mark it chosen). */
export function matchingPreset(rules: PolicyRules): PresetKey | null {
  for (const [key, p] of Object.entries(PRESETS) as [PresetKey, (typeof PRESETS)[PresetKey]][]) {
    const r: PolicyRules = p.rules;
    const same = (Object.keys(r) as (keyof PolicyRules)[]).every((k) => {
      const a = r[k];
      const b = rules[k];
      return Array.isArray(a) && Array.isArray(b) ? sameList(a, b) : a === b;
    });
    if (same) return key;
  }
  return null;
}

const money = z
  .union([z.literal(""), z.null(), z.coerce.number().int("Whole rupees only").min(1, "Use a positive amount, or leave it blank").max(100_000_000, "That's too large")])
  .transform((v) => (v === "" || v === null ? null : v));
const time = z
  .union([z.literal(""), z.null(), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:\d\d)?$/, "Use a time like 12:00")])
  .transform((v) => (v ? v.slice(0, 5) : null));
const choice = z.enum(["allowed", "approval", "prohibited"]);

export const PolicyRulesInput = z
  .object({
    autoPerHead: money,
    managerPerHead: money,
    maxPerHead: money,
    approvalAbove: money,
    seniorAbove: money,
    monthlyLimit: money.transform((v) => v ?? 0),
    maxDistanceKm: z
      .union([z.literal(""), z.null(), z.coerce.number().gt(0, "Distance must be more than 0 km, or blank for no limit").max(200, "Distance can be at most 200 km")])
      .transform((v) => (v === "" || v === null ? null : Math.round(v * 10) / 10)),
    alcohol: choice,
    weekdayAlcohol: choice,
    hoursStart: time,
    hoursEnd: time,
    entertainment: z.array(z.enum(Object.keys(ENTERTAINMENT) as [Entertainment, ...Entertainment[]])).transform((v) => [...new Set(v)]),
    eventTypes: z.array(z.enum(Object.keys(EVENT_TYPES) as [EventType, ...EventType[]])).transform((v) => [...new Set(v)]),
  })
  .superRefine((v, ctx) => {
    if (v.autoPerHead != null && v.managerPerHead != null && v.managerPerHead < v.autoPerHead) {
      ctx.addIssue({ code: "custom", path: ["managerPerHead"], message: "The manager limit must be at least the instant-booking limit" });
    }
    if (v.approvalAbove != null && v.seniorAbove != null && v.seniorAbove < v.approvalAbove) {
      ctx.addIssue({ code: "custom", path: ["seniorAbove"], message: "Senior approval must start at or above the first approval amount" });
    }
    if ((v.hoursStart === null) !== (v.hoursEnd === null)) {
      ctx.addIssue({ code: "custom", path: [v.hoursStart === null ? "hoursStart" : "hoursEnd"], message: "Set both times, or clear both" });
    }
    if (v.hoursStart !== null && v.hoursStart === v.hoursEnd) {
      ctx.addIssue({ code: "custom", path: ["hoursEnd"], message: "Start and end can't be the same time" });
    }
  });
export type PolicyRulesFormInput = z.input<typeof PolicyRulesInput>;

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const asChoice = (v: unknown): AlcoholChoice => (v === "approval" || v === "prohibited" ? v : "allowed");

/** Rules from the stored rows (corporate_policies + companies.monthly_spend_limit_inr). */
export function rulesFromRows(
  policy: {
    auto_approval_limit_per_head?: unknown;
    manager_approval_limit_per_head?: unknown;
    max_budget_per_head?: unknown;
    requires_approval_above?: unknown;
    high_value_threshold?: unknown;
    max_office_distance_km?: unknown;
    alcohol_policy?: unknown;
    weekday_open_bar_policy?: unknown;
    event_hours_start?: unknown;
    event_hours_end?: unknown;
    restricted_entertainment?: readonly string[] | null;
    restricted_event_types?: readonly string[] | null;
  } | null,
  monthlyLimit: unknown
): PolicyRules {
  const hhmm = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 5) : null);
  return {
    autoPerHead: num(policy?.auto_approval_limit_per_head),
    managerPerHead: num(policy?.manager_approval_limit_per_head),
    maxPerHead: num(policy?.max_budget_per_head),
    approvalAbove: num(policy?.requires_approval_above),
    seniorAbove: num(policy?.high_value_threshold),
    monthlyLimit: Number(monthlyLimit ?? 0) || 0,
    maxDistanceKm: num(policy?.max_office_distance_km),
    alcohol: asChoice(policy?.alcohol_policy),
    weekdayAlcohol: asChoice(policy?.weekday_open_bar_policy),
    hoursStart: hhmm(policy?.event_hours_start),
    hoursEnd: hhmm(policy?.event_hours_end),
    entertainment: (policy?.restricted_entertainment ?? []).filter((e): e is Entertainment => Object.hasOwn(ENTERTAINMENT, e)),
    eventTypes: (policy?.restricted_event_types ?? []).filter((e): e is EventType => Object.hasOwn(EVENT_TYPES, e)),
  };
}

/** The columns to store (corporate_policies upsert and companies.monthly_spend_limit_inr). */
export function rowsFromRules(r: PolicyRules) {
  return {
    policy: {
      auto_approval_limit_per_head: r.autoPerHead,
      manager_approval_limit_per_head: r.managerPerHead,
      max_budget_per_head: r.maxPerHead,
      requires_approval_above: r.approvalAbove,
      high_value_threshold: r.seniorAbove,
      max_office_distance_km: r.maxDistanceKm,
      alcohol_policy: r.alcohol,
      weekday_open_bar_policy: r.weekdayAlcohol,
      event_hours_start: r.hoursStart,
      event_hours_end: r.hoursEnd,
      restricted_entertainment: r.entertainment,
      restricted_event_types: r.eventTypes,
    },
    monthlyLimit: r.monthlyLimit,
  };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * The rules as short sentences, in the order a booker meets them. Only rules
 * that are set; an empty list means anything can be booked without sign-off.
 */
export function summarizeRules(r: PolicyRules): string[] {
  const out: string[] = [];
  if (r.autoPerHead != null) {
    const manager = r.managerPerHead != null ? `, a manager approves up to ${inr(r.managerPerHead)}, the CFO above that` : ", anything above needs approval";
    out.push(`Up to ${inr(r.autoPerHead)} per guest books instantly${manager}.`);
  } else if (r.managerPerHead != null) {
    out.push(`Above ${inr(r.managerPerHead)} per guest, the CFO approves.`);
  }
  if (r.maxPerHead != null) out.push(`Anything above ${inr(r.maxPerHead)} per guest needs approval.`);
  if (r.approvalAbove != null || r.seniorAbove != null) {
    const parts = [r.approvalAbove != null ? `bookings above ${inr(r.approvalAbove)} need approval` : null, r.seniorAbove != null ? `above ${inr(r.seniorAbove)}, senior approval` : null].filter(Boolean) as string[];
    const s = parts.join("; ");
    out.push(`${s[0].toUpperCase()}${s.slice(1)} (before GST).`);
  }
  if (r.monthlyLimit > 0) out.push(`Spending past ${inr(r.monthlyLimit)} in a month needs senior approval.`);
  if (r.alcohol === "prohibited") out.push("Alcohol isn't allowed.");
  else {
    if (r.alcohol === "approval") out.push("Alcohol needs approval.");
    if (r.weekdayAlcohol === "prohibited") out.push("No alcohol on weekdays (Mon–Fri).");
    else if (r.weekdayAlcohol === "approval" && r.alcohol !== "approval") out.push("Alcohol on weekdays needs approval.");
  }
  if (r.hoursStart && r.hoursEnd) out.push(`Events starting outside ${r.hoursStart}–${r.hoursEnd} need approval.`);
  if (r.maxDistanceKm != null) out.push(`Venues more than ${r.maxDistanceKm} km from the office need approval.`);
  if (r.entertainment.length) out.push(`${list(r.entertainment.map((e) => ENTERTAINMENT[e]))} need${r.entertainment.length === 1 ? "s" : ""} approval.`);
  if (r.eventTypes.length) out.push(`${list(r.eventTypes.map((t) => EVENT_TYPES[t]))} events need approval.`);
  return out;
}
