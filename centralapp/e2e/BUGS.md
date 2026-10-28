# Mid-race data integrity (2026-10-24, `integrity.mjs`), fixed

**Deploy note:** needs `db/019_board_notify.sql` (`npm run migrate` / `npm run deploy`).

## BUG-10 (high): moving a runner to another category by import kept the old category's batch

**Was:** "Import bibs" and the CSV import changed `category_id` but left `batch_id`. A 5K Wave A runner moved to the 10K stayed in the 5K's Wave A, so they were timed from that wave's gun (10 minutes off in the test). The edit form already handled this.
**Fixed:** `participants.ts`: when an import changes the category, the batch is cleared.

## BUG-11 (medium): open boards did not refresh after admin changes

**Was:** boards refetch on `pg_notify('reads')`, which only a new read sent (plus a few actions). Batch moves, bib edits, category moves, deleting or adding a runner, archive/restore, station changes and a station's void left the LED wall and public board stale until the next read came in.
**Fixed:** migration 019: a trigger on reads, participants, categories, stations, batches and the course tables notifies on every change, whatever the route. Postgres folds repeats within a transaction, so an import is one refresh.

## BUG-12 (medium): deleting a station mid-race broke results for good

**Was:** its reads lost their station, and it was removed from every category's course. Adding it back re-linked the reads, but the custom courses stayed without it, so its splits and the Progress view were missing.
**Fixed:** a station with reads cannot be deleted; the admin is told to clear the reads first if they were a test. A station with no reads can still be deleted.

## Checked and fine

Changing a course mid-race, moving runners between batches, a batch assignment with a typo (all or nothing), renumbering a bib (reads follow; a station with the old roster is still credited to the new bib), moving a category in the edit form, a CSV re-import that swaps two tags, deleting and re-adding a runner (the reads come back), archiving and restoring a category, deleting a batch (its runners fall back to the category), and reads uploaded while the admin saves. No read was lost or doubled at any step.

## By design, worth knowing

- An archived category's runners leave the board until it is restored. Nothing is lost.
- Deleting a runner hides their reads until a runner with that bib or tag is added again.
- The station app never deletes a runner from its own list: after a renumber, the old bib stays there without a tag (see BUG-5).

# Open bugs found on 2026-10-24 (ESP32 -> station -> central test, `esp-race.mjs`)

Not fixed yet. `esp_readers_through_station_to_central` (sync.rs) and `esp-race.mjs` fail on them on purpose until they are.

## BUG-7 (high): reads taken right after an ESP32 reboot are silently lost

**What happens:** `seqCounter` starts at 0 on every boot (`race_reader_node.ino`), and reads recovered from the flash journal keep the seq of the boot they were taken in. But `postBatch` sends one `boot_id` for the whole batch, the current one. The station stores every read under `(device, boot_id, seq)` with `INSERT OR IGNORE` (`db::ingest`). So the first new read after the reboot (seq 1) collides with recovered read seq 1 and is dropped. The station still answers 200, and the ESP32 deletes it.

**Seen in the test:** after a power cut at the finish, runners 108 and 109 crossed right after the reboot. Their finish reads are nowhere, and both are missing from the central results.

**When:** any reboot (power bank swap, brown-out, the EN button) while reads are still in the journal, which is likely at a finish line with weak WiFi.

## BUG-8 (medium): after a reboot, reads already delivered come back as duplicates, and voids come undone

**What happens:** the journal is only compacted when the queue is empty (or over 200 KB). While reads keep arriving it still holds reads the app already confirmed. After a reboot those are resent under the new `boot_id`, so the station sees them as new reads, timed at their arrival.

**Seen in the test:** 7 duplicate finish reads. 103's double read, voided by the operator, comes back unvoided (3 counted finish reads for 103 on the central app), and the unknown tag appears twice. Ranking is not changed (the earliest finish read wins), but the Reads pages and exports are wrong, and a void can silently stop working.

**Suggested fix for both (one change):** send each read's own boot id. Firmware `postBatch`: add `"boot":"<p.boot>"` to every read. Station `IngestRead`: `#[serde(default)] boot: Option<String>`; `ingest` stores `r.boot` when present, else `b.boot_id` (older firmware). Recovered reads then dedupe against what was already stored, and new reads no longer collide. Needs a firmware reflash; the station change alone is harmless with old firmware.

## BUG-9 (medium): the central app ranks "arrival time" as if it were the read time

**What happens:** a read recovered after a reboot has no known read time (`age_ms = -1`). The station uses the arrival time and marks it `time_exact = 0` ("Late time" on the Live page). But that flag is not uploaded, so the central app ranks it as a real finish time with no warning.

**Seen in the test:** 106 and 107 crossed 40 s apart. On the central app both finish at the same moment, about 4.5 minutes late.

**Suggested:** upload `time_exact` and show those times flagged on the admin Reads and Results pages, so the director can correct them (for example from a manual or video time). BUG-7's fix does not change this: the ESP32 has no clock that survives a reboot.

# Bugs found by the end-to-end tests (2026-10-22), all fixed

Each one has a test that failed before the fix and passes now: `station-api.e2e.mjs` (central) and `db_tests.rs` (station).

**Deploy note:** the fixes need `db/018_read_identity.sql`. `npm run deploy` and `npm run migrate` apply it, and it is safe to run again. Update the central app first: a station app with the fix also works against an older central app, which ignores the new `src` field.

## BUG-5 (high): a bib renumbered or a tag moved on the central app sent reads to the wrong runner, or to nobody

**Was:** the station couldn't take the change into its runner list ("tag already assigned to another runner"). It kept uploading the old bib, and the central app trusted that bib. After a renumber the read matched nobody, so the runner dropped out of the results. After a tag move, the old runner got the times.

**Fixed, on both sides:**
- Station, `upsert_central_runner` (`db.rs`): the central app decides tags. When the central list gives a tag to a bib, the station takes it off any other local runner first.
- Station, `pull` (`sync.rs`): if the central list has the same tag on two runners, the second is skipped and reported, instead of the two taking the tag off each other on every pull.
- Central, `insertReads` (`ingest.ts`): the runner is now decided by the central app's own tag mapping first, then the bib the station sent, then a bib typed as the tag. A station whose runner list is up to 60 s behind is therefore still credited correctly.

**Left as is:** reads uploaded before the fix keep their stored bib. A renumber in the admin already moves those reads to the new bib; a moved tag does not. The old runner 101 stays in the station's local list without a tag, because runners are never deleted from it.

## BUG-3 (medium): two different reads with the same device, time and tag became one on the central app

**Was:** the central app treated device + time + tag as a read's identity. Every manual entry on a laptop uses device `MANUAL`, so a manual Start and a manual Finish typed with the same time were saved as one read.

**Fixed:**
- Station: every upload now carries the read's own identity, `src` = `<boot_id>:<seq>` (`unsynced_reads`, `sync.rs`). Manual reads use `manual-<laptop id>` as their boot_id, so two laptops' manual reads can never share an identity.
- Central: migration 018 adds `reads.src` and makes the unique key device + time + tag + src. `insertReads` matches a read by its exact `src` when one is sent.
- Kept working:
  - Reads stored before the upgrade (empty `src`) are matched and given their identity when the station sends them again, provided the station name is the same, so they are not duplicated.
  - Files without an identity (station CSV, older station apps) are still matched by device + time + tag, so re-importing a file never duplicates a live read.
  - The station's merge JSON carries `boot_id` and `seq`, so the file upload now passes the identity through (`readfile.ts`).

## BUG-4 (medium): voiding one of two same-time reads voided the other

Fixed by BUG-3: the two are now separate rows, and a void only reaches the read it was sent for.

## BUG-1 (low): `[null]` as the reads body was a server error (500)

Fixed in `routes/api/events/[slug]/reads/+server.ts`: each element must be an object. Otherwise the reply is 400.

## BUG-2 (low): a fractional `read_at_ms` was a server error (500)

Fixed in the same place: `read_at_ms` must be a whole number (`Number.isSafeInteger`). Otherwise the reply is 400.

## BUG-6 (low, found by reading the code): an admin void could be undone by a station

**Was:** when a station uploaded a read again (after its own void or restore, or after an import), its `voided` value overwrote the one the director set on the Reads page.

**Fixed:** the admin Void/Restore now also sets `reads.voided_by_admin` (migration 018), and the station upload no longer changes `voided` on such a read. The director has the final word.

## Not changed

- SvelteKit warnings on start: `config.alias` is deprecated, and `tsconfig` `paths` is overwritten. Removing the alias needs every `$lib` import moved to the `#lib` subpath imports, which is a separate clean-up. They do not affect behaviour today.
- `svelte-check` reports 7 warnings in `e/[slug]/+page.svelte` and one other file, "only captures the initial value of `data`". These were already there, and the fixes don't touch those files.

## Assumptions made while testing

- Test data I made up: 4 runners in a 5K, the stations Start, CP1 and Finish, and a race start at 2026-10-22 06:00 UTC.
- Results use gun time (the default `rank_by = elapsed`).
- The admin void test sets `voided_by_admin` directly in SQL, which is what the Void button's action does, because admin forms need a logged-in browser session.
- Not covered: the ESP32 firmware, the Tauri UI, and the admin forms in a browser.
