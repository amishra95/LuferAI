/**
 * A venue's corporate book of business: each client company's history at the
 * venue, and the next step worth taking with it (rebook, win back, upsell).
 * Pure: the property portal computes it from the venue's own bookings, and
 * tests/venue-accounts.test.mjs imports it directly.
 */

/** Bookings that happened or will: accepted by the venue and not cancelled. */
const BOOKED = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);

export interface AccountBooking {
  id: string;
  status: string;
  /** YYYY-MM-DD */
  event_date: string;
  party_size: number;
  budget_per_head_inr: number;
  total_amount_inr: number;
  company: { id: string; legal_name: string };
}

export type AccountStatus = "new" | "active" | "due" | "lapsed";

export interface Account {
  companyId: string;
  companyName: string;
  /** Pre-GST value of every booked event, past and upcoming. */
  bookedValue: number;
  /** Share of the venue's booked value, 0–1. */
  share: number;
  events: number;
  pastEvents: number;
  /** YYYY-MM-DD of the latest event held, if any. */
  lastEvent: string | null;
  /** YYYY-MM-DD of the next upcoming event, if any. */
  nextEvent: string | null;
  nextEventParty: number | null;
  avgParty: number;
  avgPerHead: number;
  /** Median days between their events, once there are at least two. */
  cadenceDays: number | null;
  /** When the next booking would be due by their cadence. */
  dueOn: string | null;
  status: AccountStatus;
}

export type OpportunityKind = "rebook" | "win_back" | "first_repeat" | "upcoming_upsell" | "premium";

export interface Opportunity {
  kind: OpportunityKind;
  companyId: string;
  companyName: string;
  title: string;
  detail: string;
  /** The client's booked value with the venue, for ordering and display. */
  value: number;
}

/** Most time-sensitive first: a due rebooking, an event coming up, a lapsed client, a first-timer, a low spender. */
const RANK: Record<OpportunityKind, number> = { rebook: 4, upcoming_upsell: 3, win_back: 2, first_repeat: 1, premium: 0 };

/** No event in this long, and nothing upcoming: lapsed. */
export const LAPSED_DAYS = 120;
/** A rebooking is flagged this many days before it's due by the client's cadence. */
export const REBOOK_LEAD_DAYS = 21;
/** Upcoming events this close get an upsell nudge. */
export const UPSELL_WINDOW_DAYS = 45;
/** Spending this far below the venue's typical per head suggests a premium offer. */
export const PREMIUM_GAP = 0.2;

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};

/** Every client with a booked event at the venue, highest booked value first. */
export function venueAccounts(bookings: readonly AccountBooking[], today: string): Account[] {
  const booked = bookings.filter((b) => BOOKED.has(b.status));
  const total = booked.reduce((s, b) => s + Number(b.total_amount_inr), 0);
  const byCompany = new Map<string, AccountBooking[]>();
  for (const b of booked) byCompany.set(b.company.id, [...(byCompany.get(b.company.id) ?? []), b]);

  return [...byCompany.values()]
    .map((list): Account => {
      const dates = list.map((b) => b.event_date).sort();
      const past = dates.filter((d) => d <= today);
      const upcoming = list.filter((b) => b.event_date > today).sort((a, b) => a.event_date.localeCompare(b.event_date));
      const gaps = dates.slice(1).map((d, i) => days(dates[i], d)).filter((g) => g > 0);
      const cadenceDays = gaps.length ? Math.round(median(gaps)) : null;
      const lastEvent = past.at(-1) ?? null;
      const dueOn = cadenceDays && lastEvent && !upcoming.length ? addDays(lastEvent, cadenceDays) : null;
      const value = list.reduce((s, b) => s + Number(b.total_amount_inr), 0);
      const status: AccountStatus = upcoming.length
        ? list.length === 1
          ? "new"
          : "active"
        : lastEvent && days(lastEvent, today) > LAPSED_DAYS
          ? "lapsed"
          : dueOn && days(today, dueOn) <= REBOOK_LEAD_DAYS
            ? "due"
            : list.length === 1
              ? "new"
              : "active";
      return {
        companyId: list[0].company.id,
        companyName: list[0].company.legal_name,
        bookedValue: value,
        share: total ? value / total : 0,
        events: list.length,
        pastEvents: past.length,
        lastEvent,
        nextEvent: upcoming[0]?.event_date ?? null,
        nextEventParty: upcoming[0]?.party_size ?? null,
        avgParty: Math.round(list.reduce((s, b) => s + b.party_size, 0) / list.length),
        avgPerHead: Math.round(list.reduce((s, b) => s + Number(b.budget_per_head_inr), 0) / list.length),
        cadenceDays,
        dueOn,
        status,
      };
    })
    .sort((a, b) => b.bookedValue - a.bookedValue || a.companyName.localeCompare(b.companyName));
}

const MONTHS = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const fmt = (iso: string) => MONTHS.format(new Date(`${iso}T00:00:00Z`));
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/**
 * The next step worth taking with each client, most valuable first: one per
 * client (its most pressing), so the list reads as a to-do list.
 */
export function accountOpportunities(accounts: readonly Account[], today: string): Opportunity[] {
  const perHeads = accounts.map((a) => a.avgPerHead).filter((v) => v > 0);
  const typical = perHeads.length >= 3 ? median(perHeads) : null;
  const out: Opportunity[] = [];
  for (const a of accounts) {
    const base = { companyId: a.companyId, companyName: a.companyName, value: a.bookedValue };
    if (a.nextEvent && days(today, a.nextEvent) <= UPSELL_WINDOW_DAYS) {
      out.push({
        ...base,
        kind: "upcoming_upsell",
        title: `Upcoming on ${fmt(a.nextEvent)}${a.nextEventParty ? ` for ${a.nextEventParty}` : ""}`,
        detail: "Offer add-ons now: a welcome drink, a live counter, AV or a dessert station."
      });
    } else if (a.status === "due") {
      out.push({
        ...base,
        kind: "rebook",
        title: `Due to rebook around ${fmt(a.dueOn!)}`,
        detail: `They book about every ${a.cadenceDays} days; the last event was ${fmt(a.lastEvent!)}. Send a quote for the next one.`
      });
    } else if (a.status === "lapsed") {
      out.push({
        ...base,
        kind: "win_back",
        title: `No event since ${fmt(a.lastEvent!)}`,
        detail: `${Math.floor(days(a.lastEvent!, today) / 30)} months without a booking (${a.events} before, ${INR.format(a.bookedValue)}). A direct quote with a returning-client rate could win them back.`
      });
    } else if (a.status === "new" && !a.nextEvent && a.pastEvents === 1) {
      out.push({
        ...base,
        kind: "first_repeat",
        title: "First event done",
        detail: `They held one event (${a.avgParty} guests). Follow up while it's fresh, with an offer for the next.`
      });
    } else if (typical && a.avgPerHead < typical * (1 - PREMIUM_GAP)) {
      out.push({
        ...base,
        kind: "premium",
        title: `Spends ${INR.format(a.avgPerHead)} a head`,
        detail: `Below your typical ${INR.format(typical)}. Next time, offer a premium package or upgrades.`
      });
    }
  }
  return out.sort((x, y) => RANK[y.kind] - RANK[x.kind] || y.value - x.value);
}

/** Headline numbers: how many clients, how many came back, and how concentrated the book is. */
export function bookSummary(accounts: readonly Account[]) {
  const repeat = accounts.filter((a) => a.events >= 2).length;
  return {
    clients: accounts.length,
    repeatRate: accounts.length ? repeat / accounts.length : 0,
    topShare: accounts[0]?.share ?? 0,
    bookedValue: accounts.reduce((s, a) => s + a.bookedValue, 0),
  };
}
