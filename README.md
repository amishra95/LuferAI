# corp-hospitality-platform

Three-sided marketplace for corporate hospitality in India — **corporates** book events, **venues** accept them, and the **platform** earns commission — with GST worked out automatically under **SAC 998596**.

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · Supabase

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000 — the portals need Supabase (below) to sign in
npm test             # GST, quote, policy and RBAC tests
```

### With Supabase

```bash
cp .env.example .env.local
npx supabase start   # needs Docker; prints the URL, anon key and service-role key
npx supabase db reset  # applies supabase/migrations/* then supabase/seed.sql
```

Put the printed values in `.env.local` and restart `npm run dev`. The header badge switches from **Mock data** to **Supabase**. For a hosted project, use `npx supabase link` then `npx supabase db push`.

## Portals

| Route | Who | What |
| --- | --- | --- |
| `/admin` | Platform ops | Total bookings, Gross Booking Value, Commission Earned, GST invoiced, venue onboarding queue, all bookings |
| `/client` | Corporate admins / EAs | Event request builder with live GST preview, booking status table, 18% GST ITC savings calculator |
| `/property` | Venue managers | Incoming requests with Approve / Decline, mark-completed, monthly payouts |

Until sign-in is built, switch the acting company or venue with `?company=<id>` / `?venue=<id>` (links are on each page).

## Project layout

```
app/
  admin/  client/  property/     # one isolated segment per portal (own layout, actions)
components/
  ui/                            # shadcn components (button, card, badge, input, label, table, native-select)
  portal/                        # portal shell, stat card, status badges
lib/
  gst-engine.ts                  # GST tax engine (see below)
  data/index.ts                  # single data layer: Supabase or in-memory mock
  data/mock-store.ts             # mirror of supabase/seed.sql
  supabase/                      # browser, server (cookie) and service-role clients + DB types
supabase/
  migrations/                    # 5 migrations, applied in order
  seed.sql
tests/gst-engine.test.mjs
```

## Database (`supabase/migrations`)

1. **`…150000_gst_reference_and_validation`** — `gst_state_codes` reference table; `gstin_checksum()` and `is_valid_gstin()` (format + checksum digit).
2. **`…150100_core_schema`** — `companies`, `venues`, `bookings`, enums `gst_type` and `booking_status`.
   - `state_code` on companies and venues is **generated from the GSTIN**, so it can't drift.
   - `bookings.gst_type` is **set by trigger** from company vs venue state code — callers can't get it wrong.
   - Status changes are guarded: `PENDING → CONFIRMED | CANCELLED`, `CONFIRMED → COMPLETED | CANCELLED`; terminal states are locked.
   - `total_amount_inr` is the **pre-GST taxable value**. Money is `numeric(14,2)`.
3. **`…150200_onboarding_and_reporting_views`** — `venue_onboarding_requests`, plus views `booking_tax_breakdown`, `platform_metrics`, `venue_monthly_payouts`, `company_itc_summary`.
4. **`…150300_portal_access_rls`** — `platform_users` maps each auth user to ADMIN / CLIENT (one company) / PROPERTY (one venue); RLS on every table enforces that isolation.
5. **`…150400_fix_gst_and_rls_issues`** — portal users can change only a booking's `status`; `gst_type` is always re-derived; clients book active venues under SAC 998596 only; `booking_tax_breakdown` keeps bookings at deactivated venues and hides commission/payout from clients.

## GST engine (`lib/gst-engine.ts`)

```ts
import { calculateGst } from "@/lib/gst-engine";

calculateGst({ total_amount: 120000, company_gstin: "07AAECV6730M1ZX", venue_gstin: "29AAJCV2268L1ZN" });
// → { document_type: "TAX_INVOICE", sac: { code: "998596", description: "Corporate Event & Hospitality Procurement Services" },
//     supply_type: "INTER_STATE", gst_type: "IGST", taxable_value: 120000,
//     tax_breakup: { cgst: {rate_percent: 0, amount: 0}, sgst: {…0}, igst: {rate_percent: 18, amount: 21600} },
//     total_tax: 21600, invoice_total: 141600, supplier: {…}, recipient: {…}, place_of_supply: {…}, … }
```

- Validates both GSTINs (structure, known state code, checksum) and throws `GstEngineError` otherwise.
- Same state → CGST 9% + SGST 9%; different states → IGST 18%.
- Arithmetic is done in integer paise, rounded per tax head, matching the SQL view.

## Seed data

All GSTINs are synthetic but pass checksum validation.

| Booking | Company → Venue | Treatment | Taxable | Tax |
| --- | --- | --- | --- | --- |
| #1 Confirmed | Nimbus Analytics (KA, 29) → The Copper Courtyard, Indiranagar | CGST + SGST | ₹1,00,000 | ₹9,000 + ₹9,000 |
| #2 Completed | Vertex Capital (DL, 07) → The Vault at UB City | IGST | ₹1,20,000 | ₹21,600 |
| #3 Pending | Nimbus Analytics (KA, 29) → Mosaic Kitchen & Bar, Koramangala | CGST + SGST | ₹1,08,000 | ₹9,720 + ₹9,720 |

Five Bengaluru venues (Indiranagar ×2, Koramangala ×2, UB City) and three onboarding requests are also seeded.

## Native apps (Capacitor)

iOS and Android shells live in `ios/` and `android/` (`appId` `com.luferai.app`). The app uses middleware, Server Components, Server Actions and API routes, so it can't be statically exported: the native WebView loads the **deployed site** from `CAP_SERVER_URL`, and `capacitor-shell/` only bundles the offline and "not configured" pages.

```bash
CAP_SERVER_URL=https://app.example.com npm run cap:sync   # copies the shell + config into both projects
npm run cap:open:ios        # Xcode (iOS uses Swift Package Manager — no CocoaPods)
npm run cap:open:android    # Android Studio
```

For a device against your laptop: `npm run dev -- -H 0.0.0.0`, then `CAP_SERVER_URL=http://<LAN-IP>:3000 npm run cap:sync` (cleartext is enabled only for `http://` URLs).

Safe areas: use `--app-safe-top|right|bottom|left` (or the `pt-safe` / `pb-safe` utilities) — never `env(safe-area-inset-*)` directly. They prefer the `--safe-area-inset-*` values Capacitor injects on Android, where WebView < 140 reports wrong `env()` values.

Before a store release: Google blocks OAuth inside embedded WebViews (use magic links, or add native sign-in / an in-app browser flow), UPI intent links and payment redirects need testing on real devices, and Apple may reject apps that are only a wrapped website (guideline 4.2) — plan native value such as push notifications.

## Next steps

- **Data access:** reads still go through `lib/supabase/admin.ts` (service role) after `requirePortal` checks; moving them to `lib/supabase/server.ts` adds RLS as a second line of defence.
- **Tax review:** have a tax advisor confirm SAC 998596 and ITC eligibility for your exact supply model — ITC on food & beverage is restricted under Section 17(5) of the CGST Act, and who the supplier of record is (venue or platform) changes the invoicing.
