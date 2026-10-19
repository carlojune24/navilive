---
version: 1
slug: "app"
primary_target: "app"
related_targets: []
---

## Scope
Operate surface: the whole Race Tracker desktop app (Live, Results, Runners, Setup).

## Direction contract
THESIS: The app is a race bib you read at a glance; refuses the generic grey admin dashboard.
OWN-WORLD: Tyvek-white ground (cool, slightly blue-grey paper, not cream), ink-black type, heavy condensed grotesk bib numerals, perforation-dot dividers and notched corners, station kind color bands (start green, checkpoint orange, finish vermilion) always with text label. shadcn components restyled: square corners, 2px ink borders, no shadows.
STORY: Operator sees the newest tag read as a monumental bib band, trusts the feed beneath it, and fixes misses fast.
FIRST VIEWPORT: Left narrow nav rail (Live/Results/Runners/Setup) with connection status strip; main: top monumental last-read band (bib numeral ~140px, runner name, station chip, time) and below a fixed-cell table feed where new rows flip in character by character. Right column: devices online + manual entry. Primary action: Manual entry.
FORM: Tyvek bib sheet, assigned candidate 6, seed 45a359f0.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
