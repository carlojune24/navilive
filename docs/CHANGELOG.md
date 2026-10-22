# Changelog

Notable changes to Race Central (`centralapp`) and the station app (`perstationapp`).
Anything older than the first entry here is in `git log`.

## 2026-10-22

### Results · timing is decided by the category alone

- **The Gun time / Own start toggle is gone from the live board.** It globally forced
  every category to be timed one way, overriding each category's own *Winner decided
  by* (`rank_by`), and let a spectator change how results rank on a public screen.
  Each category now decides for itself, and the board already states which on the
  "Ranked by:" line. `?mode=own` still works as a URL override; nothing in the UI
  produces it.

- **A finisher with no start time is now reported instead of vanishing.** A runner's
  time is `finish − start`; if the start is unknown, the row was dropped from the
  ranking with no trace and counted as "not started" although they had crossed the
  line. Results (board and admin) now show, under "Ranked by:":

  > *1 runner has crossed the finish but has no start time — press Start for this
  > category, or add their start read on the Reads page.*

  This happens when a category is ranked by **own start read** and the runner was never
  read at the start with Start never pressed, or when nobody was read at the start and
  Start was never pressed at all. Both are recoverable, but only if someone notices.

  Missing **checkpoint** reads never prevented a finish time and still do not — they
  only cost a split, and Progress already flags them.

### Progress · Total time column

The Progress table showed the race time at each station, so a finisher's total was only
readable by finding the Finish column at the far right of a sideways-scrolling table,
and that cell falls back to a bare clock time when the start is unknown.

A **Total time** column now ends the row: the official elapsed time once a runner
finishes, `—` while they are out. The value is not recomputed — it is the same figure
the ranked results use, so it follows the category's *Winner decided by* automatically
and cannot disagree with the Results page. No ticking clock, so a 189-row table does not
redraw every second. The admin Progress page gets it too, with **Check** still last.

Worth knowing: a runner in a batch is timed from their **batch** gun, and the category
gun is ignored for them.

### Live map · Dim control for LED walls

The route map is shown on an LED wall, where bright, shimmering areas of the basemap
washed out the route, the station pins and their labels. Satellite imagery is the
worst case: its fine high-frequency texture aliases against the panel's pixel pitch,
and its highlights clip, because most LED processors crush anything above ~235.

A global brightness control would have dimmed the route and labels too — exactly what
has to stay legible. Instead:

- A **Dim** slider (0–90%) fades a black scrim layer inserted *between* the basemap and
  the overlays, so the basemap and its place names darken while the route, pins, labels
  and elevation profile keep full strength. That layer ordering is the whole mechanism.
- **Display mode** (`?display`) dims to 40% by default, and the `DISPLAY` chip carries the
  current value into the URL (`?display&dim=55&cat=6`), so you set the level where you
  can see the slider and send that link to the wall. Values are clamped; junk falls back.
- **Overlays get heavier in display and fullscreen only**, for the pixel pitch: route line
  6→10px, glow 14→20, station dots 14/17→18/22, label text 14→20 with halo 2.2→3.5.
  The normal browser view is unchanged.
- The wall already defaulted to the dark basemap, so no change was needed there.

Rules of thumb for a wall, if the default does not suit yours: indoor panels are
typically P2.5–P4 and run 600–1500 nits (outdoor 3500–6000+) against the ~300 nits of
the monitor the design was made on, and comfortable viewing distance in metres is about
the pixel pitch in mm. Expect to land between 30% and 70% depending on the room.

### Build · maplibre is pre-bundled

`maplibre-gl` is reached only through a dynamic `import()`, so in dev Vite discovered it
the first time anyone opened the map and re-optimized mid-session, forcing a reload at
the worst possible moment; with a stale dep cache the import fails outright and the map
shows "The map could not be loaded." `optimizeDeps.include` now pre-bundles it at
startup. Production builds were never affected — there the import is compiled to a real
chunk.

Note: running two dev servers against one checkout makes them fight over
`node_modules/.vite`, which produces the same failure. Run one.

### Events · publish and unpublish

Every event was public from the moment it existed: anyone who knew or guessed
`/e/<slug>` saw the live board, including a half-set-up event, a rehearsal or last
year's race. There was no way to take a board down afterwards either.

- An event is now a **draft** until you publish it. The Events list shows `LIVE` or
  `DRAFT` per row with a Publish / Unpublish button.
- While a draft, the whole public surface under `/e/<slug>` answers **404** — the same
  as a wrong slug, so a draft cannot be found by guessing names. The six endpoints
  (board, map, map data, photos, results JSON, SSE stream) are gated in one place,
  `hooks.server.ts`, beside the existing `/admin` check, so none can be left open.
- A signed-in admin still sees the real board, so you can check an event before
  publishing it.
- **Stations are unaffected**: `/api/events/<slug>/*` is authenticated by API key and
  keeps accepting reads before an event is published, which is what you need before
  the gun.
- New events start as drafts. Events that existed before this change were backfilled
  as published, so nothing went dark. The backfill in `db/017_published.sql` is inside
  a guard that checks whether the column already exists, because `migrate.ps1`
  re-applies every file on each deploy and a bare `update` would silently re-publish
  an event you had deliberately taken down.

Run `npm run migrate` after pulling this.

### Admin · Categories page

The page listed every category one under the other, each with its batches stacked
inside it and the runners hidden behind collapsed disclosures. With a real field of
runners that is a very long page and two clicks to see who is in a batch.

- **One category per tab.** A tab strip across the top picks the category; only that
  one is shown. Same control the Progress page already uses.
- **One batch per tab inside it.** The category's batches are a second tab strip,
  plus a *Not in a batch* tab for runners who have not been assigned. The selected
  batch's start controls sit directly under the strip. A green dot on a tab means
  that batch has already started, so the state of every batch is visible without
  switching tabs.
- **Search inside the category.** A box beside the batch tabs searches the whole
  category by bib or name, across all batches, not just the open tab. Each hit shows
  the batch it belongs to, with Remove if it is in one and the batch dropdown if it
  is not. Clearing the box, or clicking any tab, returns to the tab view.
- **Add batch / Assign runners / Find runner** moved from the bottom of the panel to
  the top right, beside *Winner decided by*.
- A category with no batches now lists its runners; previously they were not shown
  at all.

Display only — no schema change and no new server action. The per-batch runner list
and the *Not in a batch* list were near-identical markup and are now one list.

Files: `centralapp/src/routes/admin/[slug]/+page.svelte`
