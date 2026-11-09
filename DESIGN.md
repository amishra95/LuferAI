---
name: Lufer
description: Corporate events and hospitality for Bengaluru, drawn as the GST bill book finance already trusts.
colors:
  carbon: "#2b3a8c"
  carbon-deep: "#1f2a6b"
  carbon-light: "#3c4ba3"
  carbon-bright: "#9aa8f5"
  carbon-ink: "#151a3b"
  carbon-muted: "#545b82"
  on-carbon-muted: "#c4ccf0"
  duplicate: "#f6d9de"
  triplicate: "#f7e9a8"
  triplicate-deep: "#e8c547"
  stamp: "#6b3fa0"
  stamp-ink: "#5a3190"
  ruling: "#d3d9ef"
  paper: "#f4f5fa"
  white: "#ffffff"
  night: "#10142e"
  night-surface: "#1a2049"
  night-raised: "#242b5c"
  night-line: "#2e3670"
  mint: "#3dd6b5"
  mint-ink: "#0b6b57"
  gold-ink: "#6e5200"
  error: "#e5484d"
  diya-flame: "#ff6b4a"
typography:
  display:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 5vw, 3.9rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 118"
  headline:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.6rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
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
  label:
    fontFamily: "Anek Latin, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
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
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.carbon-deep}"
  button-primary-on-carbon:
    backgroundColor: "{colors.triplicate}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.control}"
    padding: "14px 28px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.carbon}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  landing-button-primary:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "14px 28px"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  sheet:
    backgroundColor: "{colors.white}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  stamp-badge:
    backgroundColor: "transparent"
    textColor: "{colors.carbon}"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
  stamp-success:
    backgroundColor: "#e1f5ee"
    textColor: "{colors.mint-ink}"
    rounded: "{rounded.badge}"
  stamp-warn:
    backgroundColor: "{colors.triplicate}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.badge}"
  bill-stamp:
    backgroundColor: "transparent"
    textColor: "{colors.stamp}"
    rounded: "{rounded.control}"
    padding: "5px 12px"
  sidebar-cover:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.paper}"
---

# Design System: Lufer

## Overview

**Creative North Star: "The GST Bill Book"**

Lufer is drawn as the Indian duplicate/triplicate bill book every finance team already trusts. An event is written up once as line items on a white original sheet, stamped as it passes each check, and copied for everyone who needs it. Carbon-blue ink is the brand: it is the cover (site header, hero, app sidebar and top bar, the finance band) and the ink of everything printed on the sheets. Copies are coloured paper: the pink duplicate for the venue's side and secondary slips, the yellow triplicate for the one filled action on carbon, highlights and the closing call to action. Pale blue ruling divides rows; a double rule closes every sheet header and every total. State is a rubber stamp.

The world is calm, dense where the books are dense, and literal about its metaphor: tables are "Particulars", features are numbered line items, amounts are typed in Courier Prime as if filled in on the sheet, illustrative sheets carry a SPECIMEN mark. The public site is always light (paper and carbon in every OS theme); the app follows the OS into a night-blue dark mode where the same semantic roles re-resolve.

The category default this world replaces is a split hero of headline beside a dashboard screenshot over rows of icon cards. The hero is instead an open bill book page with stamps landing on it.

**Key Characteristics:**
- Carbon-blue cover, white sheets on cool paper, pink and yellow copies as secondary surfaces.
- Pale blue single rules between rows; a 3px double rule under every sheet header and above every total.
- State as rubber stamps: outlined, uppercase, tracked, near-square; rotated on the landing, upright in the app.
- One family (Anek Latin) for every voice, widened through its wdth axis for display; Courier Prime only for written-in entries and amounts.
- Near-square corners throughout (3 to 8px); flat app surfaces, softly lifted loose sheets on the landing.

## Colors

A carbon-copy palette: one deep blue ink, two coloured copy papers, a violet stamp ink and a pale blue ruling, all on a cool white paper.

### Primary
- **Carbon Ink Blue** (carbon): The brand. The bill book's cover in the site header, hero, finance band, auth aside and the app sidebar/top bar; the primary action fill on light grounds (white text, 10.3:1); headings and printed type on landing sheets; the double rule on sheets. Deepens to **Carbon Deep** (carbon-deep) for hover and the dark-mode carbon contexts; lifts to **Carbon Raised** (carbon-light) for surfaces inside carbon; brightens to **Carbon Bright** (carbon-bright) as link, focus and primary action on dark grounds.

### Secondary
- **Duplicate Pink** (duplicate): The second copy. The pink sheet peeking under the hero invoice, the tax-split slip in the product preview, and the full-bleed band of the venues section (the venue's copy). Never text, never an action.
- **Triplicate Yellow** (triplicate): The third copy. The single filled action on carbon grounds (Get started, Plan your first event in the hero), the closing CTA panel, the Lufer column in the comparison table, the top-pick row highlight, warn-stamp wash and the focus ring inside carbon. **Triplicate Deep** (triplicate-deep) is its saturated form for warn marks and meters on dark.

### Tertiary
- **Rubber-Stamp Violet** (stamp): Stamp ink. Every stamp on the landing and auth pages (IN POLICY, APPROVED, PAID, NEEDS APPROVAL), the step numerals in "How it works", and the default accent fill (ITC meter). **Stamp Ink** (stamp-ink) is its text-strength form (8.4:1 on paper).

### Neutral
- **Bill Paper** (paper): The landing and app canvas in light mode; the sheet sits on it in white.
- **Original White** (white): Sheets, cards, panels, inputs, popovers.
- **Ruling Blue** (ruling): Row rules, sheet borders and card dividers on light grounds.
- **Carbon Type** (carbon-ink): Body text on light grounds.
- **Faded Carbon** (carbon-muted): Secondary text on paper (6.3:1).
- **Cover Muted** (on-carbon-muted): Secondary text and nav links on carbon.
- **Night Cover** (night), **Night Sheet** (night-surface), **Night Raised** (night-raised), **Night Rule** (night-line): The app's dark mode canvas, surfaces, selected rows and rules.

### Status
- **Done Green** (mint, text as mint-ink), **Pending Yellow** (triplicate wash, text as gold-ink), **Refused Red** (error, text mixed 80% toward ink for contrast). App status only; on the landing everything is stamp violet.

### The Mark
- **Diya Flame** (diya-flame): The coral flame of the Diya logo and nowhere else. The bowl is carbon on light grounds and white on carbon. Fixed hexes, identical in dark mode.

### Named Rules
**The No-Hex Rule.** Components use the semantic roles (canvas, surface, fg, fg-muted, line, line-strong, frame, link, focus, go, sage, warn, rose), never a palette hex. globals.css maps them for light, dark and carbon contexts; that mapping is the only place colour is decided.

**The Carbon Context Rule.** Anything placed on the cover sits inside a carbon context (the `.on-plum` class), which remaps the same semantic names: text turns paper white, the primary action turns triplicate yellow with carbon text, focus and selection turn yellow. Never hand-colour a component for carbon.

**The One Filled Action Rule.** One filled button per view. On light grounds it is carbon; on carbon it is the yellow copy. Every other action on carbon is a white outline.

**The Flame Rule.** Coral exists only in the Diya mark. Older class names that say "coral" now resolve to stamp violet.

## Typography

**Display Font:** Anek Latin by Ek Type, variable with the width axis (fallback ui-sans-serif, system-ui)
**Body Font:** Anek Latin (same family)
**Ledger Font:** Courier Prime (fallback ui-monospace)
**Code Font:** Geist Mono, for code, kbd and pre only

**Character:** An Indian foundry's grotesque does every job, from the wide printed header of the bill book to 11px column heads; Courier Prime is the typewriter that fills the sheet in.

### Hierarchy
- **Display** (700, 2.4rem rising to 3.9rem at xl, line-height 1, width 118%): The hero headline and the closing CTA, white on carbon or carbon on triplicate. The `font-wide` stretch is reserved for display, the wordmark and the "TAX INVOICE" sheet title.
- **Headline** (700, 1.875rem rising to 2.6rem, line-height 1.05): Landing section headings, carbon on paper. Normal width.
- **Title** (700, 22px, 1.2): Page titles in the app and on legal sheets.
- **Card Title** (600, 16px, 1.3): Sheet and card titles.
- **Body** (400, 15px, 1.5): Running text; landing lead paragraphs step up to 18 to 20px, max about 42rem.
- **Meta / Caption** (13px / 12px, 1.5): Secondary lines, table cells holding figures, hints.
- **Label** (600, 11 to 12px, uppercase, tracked 0.06 to 0.12em): Table column heads, stat-sheet heads, the "Particulars" head of a ledger sheet, stamp text. Labels live inside sheets as column and copy headings.
- **Ledger** (Courier Prime 400/700, 13 to 15px, tabular): Written-in entries: invoice line items, rates, totals, bill numbers, step numerals, headline figures on stat sheets, copy marks ("Finance copy").

### Named Rules
**The One Family Rule.** Anek Latin is the only interface face. Width, weight and case make the hierarchy; no second display face.

**The Written-In Rule.** Courier Prime appears only for what would be filled in by hand or typewriter on the sheet: entries, amounts, numbers. Never for headings, buttons, navigation or prose.

**The Tabular Figures Rule.** Money, counts, codes and timestamps use tabular digits (`figure` in Anek, or Courier Prime on sheets); right-aligned table cells hold figures.

## Layout

Two page widths: the workspace at 80rem and the public site at 72rem, both centred with gutters of 1rem, 1.5rem from 40rem and 2rem from 64rem. Public sections are separated by a vertical block of 2.5rem padding per side, 4rem from 64rem. The public site alternates full-bleed grounds as the book's pages: carbon cover (header, hero, finance), paper, pink duplicate (venues), and a triplicate panel to close.

Lists of features, steps and capabilities are ruled sheets of numbered rows (a narrow numeral column, a title, a description; three columns from md), not grids of icon cards. Photography is captioned like a line item: title, then a dotted leader rule to the edge.

The app is a carbon sidebar (the cover) beside a paper canvas, with a carbon top bar; content sits on white sheets. Auth pages put the cover beside the form from lg (with the stamped invoice) and shrink it to a wordmark band on phones. Legal pages set the policy text on one white sheet at max 48rem.

Mobile: touch targets are at least 44px under coarse pointers; the app reserves room for a fixed bottom nav plus the home indicator; safe-area insets come from the `--app-safe-*` properties, never `env()` directly.

## Elevation & Depth

The app is flat: sheets sit on paper with a 1px frame and at most a hairline shadow (`0 1px 2px rgb(21 26 59 / 0.05)`), removed entirely in dark mode where tonal steps (night, night-surface, night-raised) carry depth. Floating bars and drawers are opaque surfaces with a border, never blurred. On the landing, the illustrative loose sheets (hero invoice, product preview, ledger sheets) are lifted off the paper with long, soft, negative-spread drop shadows, and copies are offset and slightly rotated beneath the original, as real loose pages would sit.

### Shadow Vocabulary
- **Hairline** (`box-shadow: 0 1px 2px rgb(21 26 59 / 0.05)`): Every app sheet and card in light mode.
- **Loose sheet** (`box-shadow: 0 18px 40px -24px rgb(21 26 59 / 0.35)` to `0 24px 50px -24px rgb(0 0 0 / 0.55)`): Landing illustrative sheets only; the stronger end over carbon.

### Named Rules
**The Flat Desk Rule.** App surfaces are flat at rest. Depth comes from the frame border, the double rule and tonal steps; hover steps the border and background, never adds shadow.

## Shapes

Near-square, printed-paper corners. Stamps, pills and step markers are 3px; monogram tiles and key caps 4px; buttons, inputs and landing sheets 6px; app sheets and tables 8px; page-level blocks 12px. Borders are 1px ruling or frame; stamps are outlined at 1.5px (3px for the large landing stamp). The double rule (`border-bottom: 3px double`) is the signature edge: under sheet headers, the stat-sheet head, legal "Last updated" lines, the footer top, and above every total. Dotted leader rules join caption titles to the edge. Only status dots and meters are fully round.

## Components

### Buttons
Printed and plain: near-square, semibold, no shadow.
- **Shape:** Gently squared (6px).
- **Primary:** Carbon fill, white text, 36px tall, 16px inline padding, 13px semibold. On carbon grounds it becomes triplicate yellow with carbon text; in dark mode carbon-bright with night text.
- **Hover / Focus:** Background deepens over 100ms; focus is a 2px outline in the focus role, offset 2px.
- **Outline (default secondary):** Transparent with a strong ruling border; hover fills surface-hover and the border darkens to text colour.
- **Secondary:** Carbon outline and carbon text, for repeated or competing actions in lists.
- **Ghost:** Borderless muted text; hover fills surface-hover.
- **Landing CTAs:** Larger (14px by 28px padding, 16px text). Outline is a 1.5px carbon border; on carbon a 1.5px white-at-45% outline keeps yellow the only fill.

### Stamps (badges)
- **Style:** Outlined in the state colour over a faint wash, uppercase, tracked 0.06em, 600 weight, 11px, 1.5px border, 3px corners. Always a word; colour only confirms it.
- **App states:** done green (mint-ink on mint wash), pending yellow (gold-ink on triplicate wash), refused red, neutral carbon or grey outline. Upright.
- **Landing / auth:** violet stamp ink only, told apart by the word. The hero stamps are large (800 weight, 118% width, 3px border, multiply blend at 0.9 opacity), rotated -9deg and 6deg, and land in sequence once on load (scale 1.6 to 1 over 420ms, `cubic-bezier(0.16, 1, 0.3, 1)`, at 500ms then 1050ms), settled immediately under reduced motion. Small list stamps may tilt -3deg.

### Pills
- **Style:** 3px corners, 1px line border, transparent, muted 12px text with tabular digits; always paired with a dot or icon.

### Cards / Sheets
- **Corner Style:** 8px in the app, 6px on the landing.
- **Background:** Surface (white; night-surface in dark; carbon-light in carbon contexts).
- **Shadow Strategy:** Hairline (see Elevation).
- **Border:** 1px frame (carbon-light at 30%); a bordered header sits on the 3px double rule in line-strong.
- **Internal Padding:** 20px (24px for large).
- **Interactive:** border steps to line-strong and background to surface-hover over 100ms; selected takes the link colour border.

### Ledger Sheet (signature)
A white sheet with a header row on a carbon double rule: "Particulars" as a tracked label on the left, the copy mark in Courier Prime on the right ("Organiser's copy", "Finance copy", "Venue's copy"). Rows are ruled in ruling blue, numbered 01, 02 in Courier Prime, title in carbon semibold, description in faded carbon.

### Bill Sheet (signature)
The hero invoice: "TAX INVOICE" in wide uppercase display, SAC and bill number in Courier Prime, a double-ruled particulars strip, line items and the total in Courier Prime with a carbon double rule above the total, SPECIMEN marked, the pink duplicate offset and rotated 2.2deg beneath. Reused in the auth aside.

### Stat Sheet
Label head (uppercase, tracked 0.08em, muted) on the double rule with an optional 14px line icon; figure in Courier Prime bold at 1.35 to 1.6rem; optional 6px meter (stamp violet, yellow at warn, red over); change and hint in 12px.

### Inputs / Fields
- **Style:** 36px tall, 6px corners, 1px line-strong border, surface fill, 15px text, 12px inline padding.
- **Focus:** border turns the focus colour with a 1px ring of the same.
- **Error / Disabled:** invalid borders in rose; disabled at 50% opacity. Required labels carry an asterisk.

### Navigation
- **App:** the carbon cover sidebar, paper-white items with line icons, muted group labels in sentence case, collapsible; carbon top bar with breadcrumbs, search with a key-cap hint, account.
- **Landing header:** sticky carbon bar, white wordmark, muted links that turn white on hover, a small yellow "Get started". Footer sits under a carbon double rule.

### Tables
Framed (1px frame, 8px corners), scroll sideways inside the frame. Column heads are 12px semibold uppercase tracked 0.05em in muted text; rows ruled; figures right-aligned and tabular.

## Do's and Don'ts

### Do:
- **Do** use the semantic roles and let carbon contexts remap them; put anything on the cover inside a carbon context.
- **Do** close every sheet header and every total with the 3px double rule.
- **Do** write state as a stamp with a word: violet only on public pages; semantic ink (green, yellow, red, carbon) in the app.
- **Do** set money, counts and codes in tabular figures, and written-in sheet entries in Courier Prime.
- **Do** mark every illustrative sheet SPECIMEN.
- **Do** use pink for the venue's copy and secondary slips, yellow for the single action on carbon and for highlights.
- **Do** keep corners between 3px and 8px on controls and sheets (12px only for page-level blocks).
- **Do** settle every animation immediately under reduced motion.

### Don't:
- **Don't** build feature sections as grids of icon cards, or a hero of headline beside a dashboard screenshot; use ruled, numbered sheets and the bill book page.
- **Don't** put a small uppercase kicker above a section heading; tracked labels belong inside sheets as column and copy heads.
- **Don't** use coral anywhere but the Diya flame.
- **Don't** set Courier Prime for headings, buttons, navigation or prose.
- **Don't** use more than one filled button in a view, or a filled non-yellow button on carbon.
- **Don't** add shadows to app surfaces beyond the hairline, or blur behind floating bars.
- **Don't** rely on colour alone for state: a stamp has a word, a pill has a dot or icon, a change has a sign and arrow.
- **Don't** put a hex value in a component (the Diya mark's fixed hexes are the one exception).

## Known Open Items

- **Summary stat sheets.** The app's summary stat cards are restyled as ruled sheets (double-ruled label head, Courier Prime figure) but keep the three-up big-number layout across about 9 dashboard pages. Rebuilding them as a single ruled summary sheet is pending the user's decision; until then the stat sheet above is the shipped pattern, not a target to copy onto new surfaces.
