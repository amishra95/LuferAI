---
name: Lufer
description: Corporate events and hospitality for Bengaluru, drawn as the GST bill book finance already trusts.
colors:
  cream: "#f3ebdd"
  cream-raised: "#fcf8f1"
  cream-line: "#e2d6c2"
  ink: "#1a1714"
  ink-muted: "#5e564c"
  ink-line: "#3a332d"
  ink-raised: "#28231f"
  ink-raised-2: "#332d28"
  on-ink: "#fcf8f1"
  on-ink-muted: "#b9afa2"
  accent: "#bf5700"
  accent-hover: "#a34a00"
  accent-text: "#a3420b"
  on-accent: "#ffffff"
  focus: "#bf5700"
  success: "#067647"
  success-ink: "#05603a"
  success-bright: "#5fd39a"
  warning: "#b54708"
  warning-ink: "#93370d"
  warning-bright: "#f5a35c"
  error: "#b42318"
  error-ink: "#912018"
  error-bright: "#f7978a"
typography:
  display:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 5vw, 3.9rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontStretch: "118%"
  headline:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.6rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.025em"
    fontStretch: "112%"
  title:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
  section:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
  card-title:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  ledger:
    fontFamily: "Courier Prime, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'tnum' 1"
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13px"
rounded:
  badge: "3px"
  tile: "4px"
  control: "6px"
  card: "8px"
  container: "12px"
spacing:
  gutter-sm: "1rem"
  gutter-md: "1.5rem"
  gutter-lg: "2rem"
  card-pad: "1.25rem"
  section: "2.5rem"
  section-lg: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    borderColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "transparent"
    borderColor: "{colors.ink}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
  landing-button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "14px 28px"
  landing-button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  field:
    backgroundColor: "{colors.cream-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  sheet:
    backgroundColor: "{colors.cream-raised}"
    borderColor: "{colors.cream-line}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  badge-success:
    textColor: "{colors.success-ink}"
    backgroundColor: "success 10% on cream-raised"
    rounded: "{rounded.badge}"
  badge-warn:
    textColor: "{colors.warning-ink}"
    backgroundColor: "warning 10% on cream-raised"
    rounded: "{rounded.badge}"
  badge-danger:
    textColor: "{colors.error-ink}"
    backgroundColor: "error 10% on cream-raised"
    rounded: "{rounded.badge}"
  bill-stamp:
    backgroundColor: "success 10% on cream-raised"
    textColor: "{colors.success-ink}"
    rounded: "{rounded.control}"
    padding: "5px 12px"
  sidebar:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink-muted}"
    activeTextColor: "{colors.accent-text}"
    activeMarker: "{colors.accent}"
---

# Design System: Lufer

## Overview

**Creative North Star: "The GST Bill Book"**

Lufer is drawn as the bill book every Indian finance team already trusts. An event is written up once as line items on a sheet, stamped as it passes each check, and filed. The book is open on a warm cream desk: cream is the page everywhere (landing, auth, the app's canvas, header and sidebar), sheets are a lighter cream laid on it, and ink is the type. Ink becomes a full ground in only two places: the landing's finance band and its closing call to action. Burnt orange is the one accent: the primary action, the current page, focus, the Lufer column, the Diya flame. Status is never orange; it has its own green, amber and red.

The world is calm and dense where the work is. It should feel like paperwork you trust, not a dashboard trying to impress. The interface follows the user's rule: as simple as Linear or Apple Notes. No taglines, helper text or secondary labels; if a screen needs them, fix the layout.

**Key Characteristics:**
- A warm cream page with cream-raised sheets; ink type; one burnt-orange accent.
- Cream-line single rules between rows; a 3px double rule under every sheet header and above every total.
- Status as a word on a pale tint: green, amber, red, each with its own darker ink. Rotated rubber stamps only on the landing.
- One family (Anek Latin) for every voice, widened for display; Courier Prime only for written-in entries and amounts.
- Near-square corners (3 to 8px); flat app surfaces; softly lifted loose sheets on the landing.
- Light first. The app follows the OS into dark mode (ink grounds); the landing stays light in every theme.

## Colors

Three brand colours and three status colours. `app/globals.css` is the only place a hex lives.

### Base
- **Cream** (cream, #F3EBDD): The page. Landing background, the landing header, auth pages, the app canvas, sidebar and top bar.
- **Cream Raised** (cream-raised, #FCF8F1): Sheets, cards, tables, inputs, popovers, menus and toasts on cream.
- **Cream Line** (cream-line, #E2D6C2): Row rules, card frames and dividers on cream. **Line Strong** (ink-muted mixed 75% into cream-line) is the input border and the double rule.

### Secondary
- **Ink** (ink, #1A1714): Headings and body text (15.1:1 on cream), the secondary outline button, the solid "Get started" in the landing header, selected map markers, the Diya bowl. A full background only for the landing's finance band and closing CTA (the `.on-ink` context), and as the app's dark-mode canvas.
- **Ink Muted** (ink-muted, #5E564C): Secondary text on cream (6.1:1; 6.8:1 on cream-raised), nav items at rest, column heads.
- **On Ink** (on-ink, #FCF8F1) and **On Ink Muted** (on-ink-muted, #B9AFA2): Text on ink grounds (16.9:1 and 8.3:1).
- **Ink Raised** (ink-raised, #28231F), **Ink Raised 2** (ink-raised-2, #332D28), **Ink Line** (ink-line, #3A332D): Surfaces, selected rows and rules on ink grounds and in dark mode.

### Accent
- **Burnt Orange** (accent, #BF5700): Accent only. The primary button fill (white text, 4.6:1), the current-page marker in the sidebar, focus rings, the Lufer column head in the comparison table, the Diya flame, small highlights (accent-soft: 12% on cream-raised). **Accent Hover** (#A34A00) is its hover and the primary button's edge (5.0:1 against cream). Never a section background, never body text.
- **Accent Text** (accent-text, #A3420B): Orange text and links on cream (5.3:1), and the active nav label. On ink, links turn on-ink instead.

### Status
Kept apart from the brand accent so orange never means "warning".
- **Success** (#067647, text as success-ink #05603A), **Warning** (#B54708, text as warning-ink #93370D), **Error** (#B42318, text as error-ink #912018). Badges use the hue at 10% over cream-raised as the tint, with the darker `-ink` text (6.2 to 7.0:1). In dark mode the text steps to the `-bright` forms (#5FD39A, #F5A35C, #F7978A) on a 22% tint over ink-raised.
- Semantic aliases used by components: **sage** (success), **warn** (warning), **rose** (error), with `success-soft`, `warn-soft`, `danger-soft` tints.

### The Mark
- **Diya**: a lamp bowl with a flame. The flame is the accent; the bowl is the foreground role (ink on cream, cream in dark mode and on ink). Both read tokens, so the mark has no fixed hex.

### Named Rules
**The No-Hex Rule.** Components use the semantic roles (canvas, surface, surface-raised, surface-hover, fg, fg-muted, fg-subtle, line, line-strong, frame, link, focus, accent, sage, warn, rose), never a palette hex. `globals.css` maps them for light, dark and `.on-ink` contexts; that mapping is the only place colour is decided.

**The Ink Context Rule.** Anything placed on an ink ground sits inside `.on-ink`, which remaps the same semantic names: text turns on-ink, surfaces turn ink-raised, links turn on-ink. Never hand-colour a component for ink.

**The One Filled Action Rule.** One filled burnt-orange button per view. Every other action is an ink outline on cream, a 45% on-ink outline on ink, or a ghost. The landing header's solid ink "Get started" is the one ink fill and is small.

**The Orange Is Not Status Rule.** Orange marks the brand and the action. Warnings are amber (warning), success green, refusal red, each with a word.

**The Class Order Gotcha.** `cn()` (tailwind-merge) drops a custom `text-<colour>` when a `text-caption`/`text-meta` size class follows it. Put the colour class last.

## Typography

**Display Font:** Anek Latin by Ek Type, variable with the width axis (fallback ui-sans-serif, system-ui)
**Body Font:** Anek Latin (same family)
**Ledger Font:** Courier Prime (fallback ui-monospace)
**Code Font:** Geist Mono, for code, kbd and pre only

**Character:** An Indian foundry's grotesque does every job, from the wide printed header of the bill book to 12px column heads; Courier Prime is the typewriter that fills the sheet in.

### Hierarchy
- **Display** (600, 2.4rem rising to 3.9rem at xl, line-height 1, `font-wide` 118%): The hero headline and the closing CTA. `font-wide` is reserved for display, the wordmark and the "TAX INVOICE" sheet title.
- **Headline** (600, 1.875rem rising to 2.6rem, line-height 1.05): Landing section headings. `.font-display` alone sets 112% width.
- **Title** (700, 22px, 1.2): Page titles in the app and on legal sheets.
- **Section** (600, 18px, 1.2): Section headings inside app pages.
- **Card Title** (600, 16px, 1.3): Sheet and card titles.
- **Body** (400, 15px, 1.5): Running text; landing lead paragraphs step up to 18 to 20px, max about 42rem.
- **Meta / Caption** (13px / 12px, 1.5): Secondary lines, nav items, table cells holding figures, badges.
- **Label** (600, 12px, uppercase, tracked 0.06 to 0.08em): Table column heads, stat-sheet heads, the "Particulars" head of a ledger sheet, stamp text. Labels live inside sheets, never as kickers above headings.
- **Ledger** (Courier Prime 400/700, 13 to 15px, tabular): Written-in entries: invoice line items, rates, totals, bill numbers, step numerals, stat-sheet figures, copy marks ("Finance copy").

### Named Rules
**The One Family Rule.** Anek Latin is the only interface face. Width, weight and case make the hierarchy.

**The Written-In Rule.** Courier Prime appears only for what would be filled in by hand or typewriter: entries, amounts, numbers. Never for headings, buttons, navigation or prose.

**The Tabular Figures Rule.** Money, counts, codes and timestamps use tabular digits; right-aligned table cells hold figures.

## Layout

Two page widths: the workspace at 80rem and the public site at 72rem, both centred with gutters of 1rem, 1.5rem from 40rem and 2rem from 64rem. Public sections are separated by 2.5rem of vertical padding per side, 4rem from 64rem.

The landing is one cream page: a sticky cream header with a cream-line bottom border, a cream hero beside the bill sheet, cream sections of ruled sheets, an ink finance band, and a closing CTA as an ink panel (6px corners) inside the page width. Lists of features, steps and capabilities are ruled sheets of numbered rows (a narrow Courier Prime numeral column, a title, a description), not grids of icon cards. Photography is captioned like a line item.

The app is a cream sidebar (240px, collapsing to 60px) with a cream-line right border beside a cream canvas; content sits on cream-raised sheets. Auth pages put a cream aside with the wordmark and the stamped invoice beside the form from lg, and shrink it to a wordmark bar on phones. Legal pages set the policy text on one sheet at max 48rem.

Mobile: touch targets are at least 44px under coarse pointers; the app reserves room for a fixed bottom nav plus the home indicator; safe-area insets come from the `--app-safe-*` properties, never `env()` directly.

## Elevation & Depth

The app is flat: sheets sit on cream with a 1px frame and at most a hairline shadow (`0 1px 2px rgb(17 17 17 / 0.05)`), removed in dark mode where tonal steps (ink, ink-raised, ink-raised-2) carry depth. Floating bars, docks and drawers are opaque surfaces with a border (the `glass` utility), never blurred. Dialogs and drawers sit over a scrim of ink at 55%.

On the landing, the illustrative loose sheets (hero invoice, product preview, ledger sheets) are lifted off the page with long, soft, negative-spread drop shadows, and the copy beneath the hero invoice is a cream-line sheet offset and rotated 2.2deg, as real loose pages would sit.

### Shadow Vocabulary
- **Hairline** (`0 1px 2px rgb(17 17 17 / 0.05)`): Every app sheet and card in light mode.
- **Loose sheet** (`0 18px 40px -24px rgb(26 23 20 / 0.35)` to `0 24px 50px -24px rgb(0 0 0 / 0.55)`): Landing illustrative sheets only.

### Named Rules
**The Flat Desk Rule.** App surfaces are flat at rest. Depth comes from the frame border, the double rule and tonal steps; hover steps the border and background, never adds shadow.

## Shapes

Near-square, printed-paper corners. Badges, stamps, pills and map markers are 3px; monogram tiles and key caps 4px; buttons, inputs, landing sheets and the large stamp 6px; app sheets and tables 8px; page-level blocks 12px. Borders are 1px; small stamps are outlined at 1.5px, the large landing stamp at 3px. The double rule (`border-bottom: 3px double`, line-strong in the app, ink on the landing) is the signature edge: under sheet headers, the stat-sheet head, the comparison table head, legal "Last updated" lines, the footer top, and above every total. Only status dots, meters and the active-nav marker's end are round.

## Components

### Buttons
Printed and plain: near-square, semibold, no shadow.
- **Primary:** Burnt orange fill with an accent-hover edge, white text, 36px tall, 16px inline padding, 13px semibold. Hover fills accent-hover.
- **Secondary:** Ink outline and ink text (fg in dark mode); hover fills surface-raised.
- **Ghost:** Borderless, fg-subtle text; hover fills surface-hover and text turns fg.
- **Destructive:** Error-ink fill, white text.
- **Focus:** 2px outline in the focus colour, offset 2px.
- **Landing CTAs:** Larger (14px by 28px padding, 16px text). Primary is burnt orange; secondary is a 1.5px ink outline on cream; on ink, a 1.5px on-ink-at-45% outline keeps orange the only fill. The header's "Get started" is a small solid ink button.

### Badges (app status)
3px corners, 1px border in the text colour, 12px weight 500, sentence case, tabular digits, optional 12px icon. Success, warn and danger use the status tint with the status ink; neutral is a line-strong outline with muted text; default is the link colour outline. Always a word; colour only confirms it.

### Stamps (landing)
- **Hero stamps:** Display font at 118% width, 800 weight, uppercase, tracked 0.08em, 3px border, 6px corners, success-ink on the success tint (status, not brand). Rotated -9deg and 6deg; they land once in order (scale 1.6 to 1 over 420ms, `cubic-bezier(0.16, 1, 0.3, 1)`, at 500ms then 1050ms) and are settled immediately under reduced motion. They shrink inside narrow sheets via a container query.
- **List stamps** (`bill-stamp-sm`): 11px, 1.5px border, 3px corners, uppercase, may tilt -3deg.

### Status Dots
6px solid circles (sage, warn, rose, fg-faint), no animation. Pair with a word.

### Cards / Sheets
- **Corner Style:** 8px in the app, 6px on the landing.
- **Background:** Surface (cream-raised; ink-raised in dark and on ink).
- **Border:** 1px frame (cream-line); a bordered header sits on the 3px double rule in line-strong.
- **Shadow:** Hairline (see Elevation).
- **Internal Padding:** 20px (24px for large).
- **Interactive** (`panel-interactive`): border steps to line-strong and background to surface-hover over 100ms; selected takes the link-colour border; focus shows the orange ring.

### Ledger Sheet (signature)
A cream-raised sheet with a header row on the double rule: "Particulars" as a tracked label on the left, the copy mark in Courier Prime on the right ("Organiser's copy", "Finance copy"). Rows are ruled in cream-line, numbered 01, 02 in Courier Prime, title in ink semibold, description in ink-muted.

### Bill Sheet (signature)
The hero invoice: "TAX INVOICE" in wide uppercase display, SAC and bill number in Courier Prime, a double-ruled particulars strip, line items and the total in Courier Prime with a double rule above the total, marked SPECIMEN, a cream-line copy offset and rotated 2.2deg beneath. Reused in the auth aside.

### Stat Sheet
Label head (uppercase, tracked, muted) on the double rule with an optional 14px line icon; figure in Courier Prime bold at 1.35 to 1.6rem; optional 6px meter; change and hint in 12px.

### Inputs / Fields
- **Style:** 36px tall (44px under coarse pointers), 6px corners, 1px line-strong border, surface fill, 15px text, 12px inline padding.
- **Focus:** the orange focus ring.
- **Error / Disabled:** invalid borders in rose; disabled at 50% opacity. Required labels carry an asterisk; no "(optional)".
- **Password:** a show/hide toggle inside the field.

### Navigation
- **App sidebar:** cream canvas, cream-line right border, the Diya mark (or an ink monogram tile for a workspace) and wordmark at the top, 32px items with 16px line icons (stroke 1.75) in 13px medium fg-subtle. Hover fills surface-raised. The current page fills surface-raised, turns its label accent-text and its icon fg, and carries a 3px burnt-orange bar at the left edge. Groups are divided by a cream-line rule.
- **Landing header:** sticky cream bar with a cream-line bottom border, ink wordmark, ink-muted links that turn ink on hover, a small solid ink "Get started". The footer sits under a double rule.

### Tables
Framed (1px frame, 8px corners), scroll sideways inside the frame. Column heads are 12px semibold uppercase tracked in muted text; rows ruled in line; figures right-aligned, tabular, at 13px. On the landing comparison, the Lufer column head is burnt orange with white uppercase text, and the head row sits on an ink double rule.

### Map Markers
Venue price pins: 3px corners, line-strong border, surface fill, 12px semibold tabular. Hover and hovered-from-list borders turn ink; selected fills ink with cream text. Policy fit adds a 2px border and a leading dot in sage (in policy), warn (needs approval) or rose. The office marker is a dashed ink outline.

## Motion
Short and functional: 100 to 200ms colour and border transitions; the sidebar width eases over 200ms; streaming replies show a blinking caret. The only flourish is the landing's two stamps landing once. Under `prefers-reduced-motion`, every animation and transition in the app and on the landing settles immediately and smooth scrolling is off.

## Do's and Don'ts

### Do:
- **Do** use the semantic roles and let `.on-ink` and dark mode remap them.
- **Do** keep orange to one filled action per view, the current page, focus and small highlights.
- **Do** close every sheet header and every total with the 3px double rule.
- **Do** write status as a word on its tint: green, amber, red, never orange.
- **Do** set money, counts and codes in tabular figures, and written-in sheet entries in Courier Prime.
- **Do** mark every illustrative sheet SPECIMEN.
- **Do** keep corners between 3px and 8px on controls and sheets (12px only for page-level blocks).
- **Do** cut helper text and taglines; fix the layout instead.
- **Do** settle every animation immediately under reduced motion.

### Don't:
- **Don't** use burnt orange as a section background or for body text.
- **Don't** use ink as a full ground anywhere but the landing finance band, the closing CTA and dark mode.
- **Don't** build feature sections as grids of icon cards, or a hero of headline beside a dashboard screenshot; use ruled, numbered sheets and the bill sheet.
- **Don't** put a small uppercase kicker above a section heading; tracked labels belong inside sheets.
- **Don't** set Courier Prime for headings, buttons, navigation or prose.
- **Don't** add shadows to app surfaces beyond the hairline, or blur behind floating bars.
- **Don't** rely on colour alone for state: a badge has a word, a pill has a dot or icon, a change has a sign and arrow.
- **Don't** put a hex value in a component.

## Known Open Items

- **Summary stat sheets.** The app's summary stat cards are restyled as ruled sheets (double-ruled label head, Courier Prime figure) but keep the three-up big-number layout across about 9 dashboard pages. Rebuilding them as a single ruled summary sheet is pending the user's decision; until then the stat sheet above is the shipped pattern, not a target to copy onto new surfaces.
