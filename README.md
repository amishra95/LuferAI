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

Put the printed values in `.env.local` and restart `npm run dev`. The header badge switches from **mock data** (or **redis**) to **supabase**.

### Data sources

`lib/data` picks one store per process: **Supabase** when configured; otherwise **Upstash Redis** (`UPSTASH_REDIS_REST_URL` / `_TOKEN`), seeded once from the demo data under `lufer:db:*` and shared by all instances; otherwise an in-memory mock. Agent telemetry (Overview metrics, activity, run counts) is always recorded in Redis when it's configured.

### Data API

Auth-scoped JSON for client components, mobile and integrations. Server Components call `lib/data` directly instead (no extra hop). Every response includes `source`.

| Route | Who | Returns |
| --- | --- | --- |
| `GET /api/venues` | workspace users | Venue directory; same `q`, `tier`, `area`, `pdr`, `min`, `sort`, `dir`, `page`, `size` params as `/venues` |
| `GET /api/bookings` | admin, client, venue | Bookings with GST invoices + platform metrics / ITC summary / monthly payouts. Clients and venues are pinned to their own; admins may pass `company`, `venue`. Optional `status` |
| `GET /api/spend` | admin, client | FY spend analytics (monthly, cumulative, savings, department budgets); admins may pass `company` (id) |
| `GET /api/analytics` | admin, client | Spend by `period` × `groupBy`; admins may pass `company` (name) |
| `GET /api/analytics/forecast` | admin, client | Spend forecast vs budget: `horizonMonths`, `department`, `costCenter`, `budgetInr`, `company` | For a hosted project, use `npx supabase link` then `npx supabase db push`.

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

## Event workspace & RSVPs (migration `…20261011120000_event_workspace_rsvps`)

Every booking has a multiplayer planning workspace at `/client/events/<booking id>` (linked from the bookings table):

- **Live collaboration** — one private Supabase Realtime channel per booking (`event:<id>`, authorised to the booking's company and admins via `realtime.messages` RLS): presence avatars, which section each person is in, live cursors, and `postgres_changes` on the guest list and schedule so everyone's view (including guests' RSVPs) updates in place. Without Supabase the workspace works single-player.
- **Guest list** — paste names and emails in any common shape; each guest gets a personal, unguessable RSVP link (`/rsvp/<token>`, no account). Organizers and Approvers edit; Finance viewers read; venues never see guest data.
- **Calendar invites** — `GET /api/events/<id>/calendar` exports an RFC 5545 `.ics` (`METHOD:REQUEST` with every guest's reply, `CANCEL` once cancelled); guests download a `PUBLISH` copy from their RSVP page. Both use the booking id as UID and bump `SEQUENCE` when the name or times change, so calendars update rather than duplicate.

Rules live in `lib/events/` (`rsvp.ts`, `ics.ts`, `presence.ts`, `invite.ts`); tests in `tests/event-workspace.test.mjs` and `tests/rls.test.mjs`.

## Marketplace settlement (migration `…20261011150000_marketplace_payouts_tcs`)

Partners stay the supplier of record on catalogue invoices; the platform collects payment as the e-commerce operator and settles through **Razorpay Route**:

| Order | Money |
| --- | --- |
| Placed | Buyer pays the invoice total from the client Catalogue tab (authorised, not captured) |
| Confirmed by the partner | Captured; a Route transfer to the partner's linked account is created **on hold** |
| Delivered | Hold released; Razorpay settles to the partner's bank |
| Cancelled | Authorisation released, or refunded with the transfer reversed |

The transfer is the invoice total less the platform commission (per partner, snapshotted on each order), 18% GST on that commission (SAC 998599, invoiced under `PLATFORM_GSTIN`), and **Section 52 TCS** (0.5% of the taxable value since 10 July 2024: CGST + SGST intra-state, IGST inter-state). `tcs_entries` is the GSTR-8 ledger (returns reversed in the month they happen); admins download a period at `GET /api/admin/tcs?period=YYYY-MM`.

- `/partner` → **Catalogue** tracks stock (reserved on order, returned on cancel); **Orders** is a fulfilment queue (confirm → ship → deliver, overdue flagged, payment and payout shown); **Payouts** (Owners, Managers) lists each split and TCS by period. Admins connect the linked account (`acc_…`, must be activated in Razorpay) and set the commission there.
- `/client` → **Purchase orders** reconciles each catalogue order's PO allocation against its payment and payout and flags mismatches.
- Logic: `lib/marketplace/settlement.ts` (pure: maths, step planner, reconciliation) and `lib/marketplace/service.ts` (Route calls, idempotent `syncOrderSettlement`). Tests: `tests/marketplace-settlement.test.mjs`, `tests/rls.test.mjs`.
- **Tax review:** confirm the TCS schedule, the commission SAC and the TCS period rule with a tax advisor before going live.

## Enterprise SSO (migration `…20261108000000_company_sso_connections`)

Companies can sign employees in through their own identity provider (SAML: Okta, Entra ID, Google Workspace). Needs Supabase Auth's SSO (Pro plan).

1. Register the provider in Supabase: `npx supabase sso add --type saml --metadata-url <IdP metadata URL> --domains acme.com --project-ref <ref>`. The IdP needs Supabase's ACS URL and entity ID (`npx supabase sso info --project-ref <ref>`).
2. Copy the provider id from `npx supabase sso list`, then in `/governance?company=<id>` → **Single sign-on**, connect the domain with that id and the role new employees get.
3. Employees choose **Continue with company SSO** on `/login`. Their first sign-in creates their membership (no application to approve), only when the session came from that domain's own provider (`lib/auth/sso.ts`).



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

## Observability & security headers

- **Server errors:** `instrumentation.ts` logs every uncaught server error as one JSON line (`"type":"server_error"`) in the Vercel runtime logs, keyed by `digest`, the "ref …" users see on error pages. Cookies, Authorization, query strings and RSVP/quote tokens are stripped (`lib/observability/error-report.ts`). A Vercel error-anomaly monitor (`vercel monitors ls`) alerts the team owner on 5xx spikes.
- **Sentry:** server, browser and error-boundary errors go to Sentry once `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set (install the Sentry integration from the Vercel Marketplace to set them). Events are scrubbed the same way, with no default PII (`lib/observability/sentry.ts`). With `SENTRY_AUTH_TOKEN`, builds upload source maps.
- **Analytics:** `@vercel/analytics` and `@vercel/speed-insights` are in the root layout; enable them under Project → Analytics / Speed Insights.
- **Headers:** `lib/security-headers.ts`, applied in `next.config.ts`: HSTS, `X-Frame-Options`, `nosniff`, Referrer and Permissions policies, and an enforced CSP limited to `frame-ancestors` / `base-uri` / `object-src`. The full CSP runs **report-only**; violations are logged as `"type":"csp_violation"` by `/api/csp-report`. Once the logs are quiet, move it to the enforced header. Generated documents (tax invoices, contracts) get a locked-down `DOCUMENT_POLICY`.

## Next steps

- **Data access:** reads still go through `lib/supabase/admin.ts` (service role) after `requirePortal` checks; moving them to `lib/supabase/server.ts` adds RLS as a second line of defence.
- **Tax review:** have a tax advisor confirm SAC 998596 and ITC eligibility for your exact supply model — ITC on food & beverage is restricted under Section 17(5) of the CGST Act, and who the supplier of record is (venue or platform) changes the invoicing.
