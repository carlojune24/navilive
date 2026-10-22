# Changelog

Notable changes to Race Central (`centralapp`) and the station app (`perstationapp`).
Anything older than the first entry here is in `git log`.

## 2026-10-22

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
