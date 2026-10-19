---
name: Race Tracker
description: A desktop race-timing console styled as a Tyvek race bib, read at a glance.
colors:
  paper: "oklch(0.955 0.008 250)"
  sheet: "oklch(0.995 0.002 250)"
  ink: "oklch(0.16 0.012 270)"
  ink-soft: "oklch(0.38 0.012 270)"
  perf: "oklch(0.7 0.01 260)"
  secondary: "oklch(0.91 0.01 250)"
  muted: "oklch(0.93 0.008 250)"
  accent: "oklch(0.9 0.012 250)"
  start: "oklch(0.5 0.14 150)"
  checkpoint: "oklch(0.66 0.17 55)"
  finish: "oklch(0.52 0.21 28)"
  focus-blue: "oklch(0.5 0.2 262)"
  fresh-flash: "oklch(0.9 0.17 100)"
typography:
  bib:
    fontFamily: "Big Shoulders Display, Barlow Semi Condensed, Impact, sans-serif"
    fontSize: "152px"
    fontWeight: 900
    lineHeight: 0.85
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Big Shoulders Display, Barlow Semi Condensed, Impact, sans-serif"
    fontSize: "44px"
    fontWeight: 900
    lineHeight: 0.85
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Barlow Semi Condensed, Segoe UI, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Barlow Semi Condensed, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Barlow Semi Condensed, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    letterSpacing: "0.025em"
rounded:
  none: "0px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "8px 20px"
  button-outline:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
  button-destructive:
    backgroundColor: "{colors.finish}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.none}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "4px 12px"
  sheet-notched:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    padding: "16px"
  nav-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    height: "48px"
    padding: "0 12px"
  station-chip-start:
    backgroundColor: "{colors.start}"
    textColor: "{colors.sheet}"
  station-chip-checkpoint:
    backgroundColor: "{colors.checkpoint}"
    textColor: "{colors.ink}"
  station-chip-finish:
    backgroundColor: "{colors.finish}"
    textColor: "{colors.sheet}"
---

# Design System: Race Tracker

## Overview

**Creative North Star: "The Tyvek Bib"**

The whole app is a race bib read at arm's length: cool blue-white synthetic paper, black print ink, monumental condensed numerals, tear-off perforations and clipped corners. It is built for an operator watching tags arrive at a finish line, so the newest read is the loudest object on screen and everything else is quiet, legible, and ruled in ink. It refuses the generic grey admin dashboard.

Density is moderate and structural. Hierarchy comes from scale contrast (a 152px numeral against 15px body) and from 2px ink rules, never from shadow, tint, or rounding. Color is rationed to meaning: three station inks and a focus blue, on a near-monochrome paper and ink field.

**Key Characteristics:**
- Cool Tyvek paper ground, black ink, no cream and no grey-on-grey.
- Heavy condensed bib numerals for identity data; semi-condensed grotesk for everything else.
- 2px ink borders, square corners, zero shadows.
- Perforation dots and 16px notched corners as the signature silhouette.
- Station kind is always color plus word.

## Colors

A near-monochrome Tyvek field with three functional station inks. Strategy: restrained neutrals, color only where it names a station kind or a fault.

### Primary
- **Print Ink** (oklch(0.16 0.012 270)): text, every border and rule, primary button fill, active nav, table header band, selection. It is both the brand and the primary action color.

### Secondary
- **Start Green** (oklch(0.5 0.14 150)): start-station band and chip, online status squares, "Online" text.
- **Checkpoint Orange** (oklch(0.66 0.17 55)): checkpoint band and chip; carries ink text, not white.
- **Finish Vermilion** (oklch(0.52 0.21 28)): finish band and chip, and also the destructive and fault color (void, offline, server-down banner, queued-reads warning).

### Neutral
- **Tyvek Paper** (oklch(0.955 0.008 250)): app ground, scrollbar track, pin-hole fill.
- **Bib Sheet** (oklch(0.995 0.002 250)): raised surfaces: nav rail, sheets, inputs, outline buttons, table.
- **Soft Ink** (oklch(0.38 0.012 270)): secondary text, de-emphasized (repeat or voided) rows.
- **Perforation Grey** (oklch(0.7 0.01 260)): perforation dots and the scrollbar rule only.
- **Secondary / Muted / Accent washes** (oklch(0.91 0.01 250) / oklch(0.93 0.008 250) / oklch(0.9 0.012 250)): hover and fallback fills.
- **Focus Blue** (oklch(0.5 0.2 262)): the focus ring and text caret only.
- **Fresh Flash** (oklch(0.9 0.17 100)): the 2.4s highlighter wash that fades off a newly arrived row.

### Named Rules
**The Color-Plus-Word Rule.** A station kind is never color alone: the band or chip carries START, CHECKPOINT, or FINISH as text.
**The Station Ink Rule.** Green, orange, and vermilion mean station kind (and, for green/vermilion, online/fault). They are never decoration.

## Typography

**Display Font:** Big Shoulders Display (900, with Barlow Semi Condensed, Impact fallback)
**Body Font:** Barlow Semi Condensed (400-700, with Segoe UI, system-ui)

**Character:** A stadium-signage condensed display against a compact, tabular working grotesk. Numerals are the hero; prose is minimal and plain.

### Hierarchy
- **Bib** (900, 152px; 104px for labels over 4 chars; 64/40px for unmapped tags; line-height 0.85): the last-read numeral only.
- **Headline** (900, 44px, 0.85): wordmark, last-read clock. Panel titles step down to 30px (text-3xl) in the same face.
- **Table numeral** (900, 36px): bib column in the feed.
- **Title** (700, 30px uppercase, tight leading): runner name in the last-read sheet.
- **Body** (400-600, 15px base; 18px in table cells; 1.5): working text, tabular figures everywhere.
- **Label** (700, 12-14px, uppercase, 0.025-0.05em tracking): field labels, table headers, status tags, buttons, nav.

### Named Rules
**The Bib Numeral Rule.** Big Shoulders is for numbers and short panel titles that read like print on a bib. Running text, form text, and buttons stay in Barlow.
**The Tabular Rule.** Tabular numerals are on for the whole app so clock and bib columns never jitter.

## Layout

A two-region shell: a fixed 216px nav rail (wordmark, four views, connection status strip) and a fluid main. The Live view is a grid of fluid column plus a 340px right column from 1200px up (reader and manual-entry panels); below 1200px it stacks and scrolls. Main column order: last-read sheet, search and toggles row, then a fixed-height scrolling feed table filling the rest. Page padding 20px, section gaps 16-20px, form stacks 12px; panels pad 16px, the last-read sheet 32px horizontally. Body does not scroll; regions do.

## Elevation & Depth

Flat. There are no shadows anywhere. Depth is conveyed by the Sheet-on-Paper step (near-white surface on blue-grey ground) and by 2px ink outlines. State is conveyed by fill inversion (ink fill with sheet text) and the dashed border for disabled, not by lift.

### Named Rules
**The No-Shadow Rule.** Separation is a 2px ink border or a paper-to-sheet step. A blur or offset shadow is out of system.

## Shapes

Square by default (radius 0 on every token, including the shadcn radius scale). The one deviation is the notch: a polygon clip that cuts 16px off each corner of major sheets, with the 2px ink border following the cut (ink polygon underneath, sheet polygon inset 2px on top). Switches are square 48x28 with a square thumb. Status indicators are 14-16px squares, not circles; the only circles are the two pin holes on the last-read band and the perforation dots. Perforation lines are rows of 3.2px dots at 12px pitch, used under the wordmark, above the status strip, and as a vertical tear line before the time stub.

## Components

### Buttons
- **Shape:** square, 2px ink border, uppercase 14px bold with 0.025em tracking.
- **Primary:** ink fill, sheet text, 44px tall (36px sm, 56px lg for the main manual-entry action).
- **Outline / Secondary:** sheet or secondary-wash fill with ink text; hover shifts to accent wash.
- **Ghost:** transparent border at rest, ink border plus accent wash on hover (used for per-row Void/Restore).
- **Destructive:** finish vermilion fill, white text.
- **Focus / Disabled:** 3px blue ring; disabled becomes a dashed border on sheet with soft ink text. Press nudges down 1px.

### Chips (Station chip)
Two-part tag inside a 2px ink border: a kind-colored cell with the kind word (START / CHECKPOINT / FINISH) and a sheet cell with the station name. Unassigned shows a dashed-border "No station". 12px uppercase.

### Cards / Containers (Sheet)
Bib Sheet fill, 2px ink border, no shadow, 16px padding. Major panels (last-read, manual entry, readers) add the notch. The feed table container is a plain bordered sheet without the notch.

### Inputs / Fields
44px tall (56px for the manual id field at 24px bold), sheet fill, 2px ink border, square. Focus: 3px blue outline. Invalid: vermilion border. Labels are 14px bold uppercase above the field.

### Navigation
Sheet-colored rail with a right ink border. Items are 48px, 18px bold uppercase with a line icon; active is ink fill with sheet text, inactive transparent with ink border on hover. A perforated rule separates the wordmark and the status strip.

### Last-Read Band (signature)
Notched sheet topped by a full-width band in the station kind color (kind word at left, station name at right, 24px bold uppercase, two paper-filled pin holes at the edges). Below: the bib numeral, runner name and flags, a vertical perforation, and a time stub (44px clock, relative age). The numeral and the feed's fresh row and clock flip in character by character (520ms, 55ms stagger).

### Feed Table
Header row in solid ink with sheet text, 14px uppercase tracked. Rows at 18px, 36px bib numerals, 15% ink row rules, soft ink and strikethrough for repeat or voided reads. Flags are small bordered tags (Void in vermilion border, Repeat, Late time, Manual inverted in ink).

### Motion
Two authored moments only: the character flip and the 2.4s row highlight fade. Both are disabled under reduced motion. Easing is cubic-bezier(0.16, 1, 0.3, 1).

## Do's and Don'ts

### Do:
- **Do** keep every border 2px Print Ink and every corner square; use the 16px notch for major sheets.
- **Do** pair every station color with its kind word.
- **Do** set identity numbers (bib, clock) in Big Shoulders 900 and everything else in Barlow Semi Condensed.
- **Do** show state by fill inversion, dashed borders, and strikethrough, with tabular numerals throughout.
- **Do** reserve the flip and row flash for genuinely new reads.

### Don't:
- **Don't** add shadows, rounded corners, or gradient fills.
- **Don't** use green, orange, or vermilion as decoration or for anything but station kind and status.
- **Don't** introduce a warm cream ground; the paper stays cool blue-white.
- **Don't** set body or form text in the display face.
- **Don't** use grey admin-dashboard patterns (soft cards, pale badges, subtle hairline-only tables).

### Not canonized (build carries, not system)
- Small-text compromises: Orange chips use ink text while other kinds use white; this is contrast-driven, kept, but the 12px chip label size is a floor to exceed, not a precedent.
- `xs` button and `icon-xs` sizes still declare `rounded-md`; it resolves to 0, so the declaration is dead and not a rule.
