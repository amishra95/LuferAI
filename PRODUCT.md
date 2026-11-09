# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The iOS and Android apps are Capacitor shells that load the deployed site (`capacitor.config.ts`), so the design language is the web one. Safe-area insets are handled in CSS.

## Users

**Primary: the company organiser.** This is the office manager, HR person or executive assistant at a Bengaluru company who has to turn "we need a venue" into a booked, approved and invoiced event. Typical events are team outings, offsites, client dinners and catering. They are not event professionals. Planning is one job among many, and today it takes a week of calls, emails and spreadsheets.

**Secondary company roles:** the approver, who signs off anything over policy, and finance, who need GST invoices, ITC decisions and Tally exports.

**Supply side:** venues (restaurants, hotels, experience studios) and suppliers (caterers, artists). They receive structured corporate requests and quote directly. They matter, but the current focus is bringing companies on board.

**Platform ops:** Lufer admins run the concierge queue, onboard venues and handle settlement.

## Product Purpose

Lufer is a corporate events and hospitality marketplace for India, starting in Bengaluru. Companies plan, approve, book and pay for events in one place. Venues win corporate business without an agency in between. Lufer earns a commission from venues on completed bookings.

Success means a company organiser goes from first request to a held date, an approved quote and a GST-correct invoice without leaving Lufer, and comes back for the next event.

## Positioning

Lufer combines four things that an events agency, a WhatsApp group of venues or a foreign tool cannot all honestly claim:

1. **GST and ITC-ready books.** Every booking gets a GST tax invoice under SAC 998596, with CGST/SGST or IGST worked out from both GSTINs. Finance gets an ITC claim/block trail and a Tally Prime export.
2. **Policy before spend.** Per-head caps, department budgets and tiered approval chains are enforced before anything is booked.
3. **Direct venue quotes.** Venues quote the company directly, with no agency markup.
4. **Concierge speed.** A quick chat or a plain-English request becomes a structured RFP and matched venues. During the current phase a human backs this up behind the scenes (see below).

## Operating Context

- Six-step flow: request (plain English or AI concierge chat) → matched venues (distance from the office, in-policy flags, what coworkers booked) → direct quotes, with dates held on a countdown → policy check and approval → online deposit → GST invoice and Tally export, with the venue paid out after the event.
- Company workspace roles: Organiser, Approver, Finance. Admins can invite colleagues by email.
- Venues answer requests by email link (no login needed) or in their portal: Requests, Events, Listing, Clients, Payouts.
- Indian business norms: GSTINs, ITC under section 17(5), Section 52 TCS on settlements, Tally as the default ledger, ₹ amounts, and Bengaluru office areas.
- **Current phase (as of Nov 2026): Wizard of Oz.** 29 real Bengaluru venues are listed under the "Lufer Concierge" partner, and requests are fulfilled by hand by Lufer ops. The focus is bringing companies on board.

## Capabilities and Constraints

- Stack: Next.js 16 App Router, TypeScript, Tailwind CSS v4, shadcn/ui, Supabase (Postgres row-level security per company), Vercel, Resend email. Hosted at lufer.app.
- Sign-in uses email magic links. Self-serve signup has two tabs: "Hosting events" (company) and "List your business" (venue or services).
- A company's GSTIN is optional until its first booking.
- Data isolation: every table is scoped per company by row-level security, and concierge memory is private to the person who saved it. Public copy states this.
- Undecided: a "Lufer corporate rate" for venues and how the venue commission is shown at signup (deferred). One account acting as both venue and supplier is post-launch.
- Open legal items: the grievance officer, registered address and legal entity are not yet final (`lib/legal.ts`). The tax example in the hero needs checking by a CA. Do not present any of these as settled.

## Brand Commitments

- Name: **Lufer** (renamed from LuferAI). Domain: lufer.app.
- Logo: the "Diya" mark, chosen in Nov 2026.
- Voice, as used in shipped copy and enforced by team review: plain, factual and specific. Short CTAs. Required fields are marked with an asterisk, with no "(optional)" labels. No hype.

## Evidence on Hand

- **29 real Bengaluru venue listings** live on lufer.app.
- **Real customer names, testimonials, and booking numbers.** The user confirms these exist, but none are in the repo yet. Get the actual names, quotes and figures from the user before using any of them. Never make up or round up customers, quotes or metrics.
- Event photography in `public/landing/` (catering-thali, client-dinner, offsite-banquet, rooftop-evening, team-celebration).
- No press, case studies or certifications are on hand.

## Product Principles

1. **Correct books are the product.** GST, ITC and approvals must be right and visible, never hidden behind convenience.
2. **Check before spend, not after.** Policy and approvals come before money moves, and the interface makes that order obvious.
3. **Respect the non-expert organiser.** Plain language, few steps and sensible defaults. Planning should not feel like procurement software.
4. **Direct and honest.** Venues and companies deal with each other directly. Commission, TCS and fees are shown openly. Claims stay true to the Wizard of Oz stage.
5. **Built for India first.** Use rupees, GSTINs, Tally and local areas as the native vocabulary, not as localisation added later.
