# Station ↔ central end-to-end tests

The unit tests (`npx vitest run` here, `cargo test` in `perstationapp/src-tauri`) cover each app alone. These cover the link between them: the station API (`/api/events/<slug>/reads|participants|heartbeat`) and the real station sync code (`sync.rs`).

They run against a **separate database `racecentral_e2e`**. They refuse any database whose name does not end in `_e2e`, so they cannot touch the real `racecentral`.

## 1. Make the test database (once, or to reset it)

From `centralapp`, in Git Bash (uses the user and password from `.env`):

```bash
URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
E2E=$(echo "$URL" | sed 's#/[^/]*$#/racecentral_e2e#')
PSQL="/c/Program Files/PostgreSQL/18/bin/psql.exe"
"$PSQL" "$(echo $URL | sed 's#/[^/]*$#/postgres#')" -c "drop database if exists racecentral_e2e" -c "create database racecentral_e2e"
for f in db/*.sql; do "$PSQL" "$E2E" -v ON_ERROR_STOP=1 -q -f "$f"; done
```

## 2. Start the central app on that database (port 5199)

```bash
sed -n 's#^\(DATABASE_URL=.*\)/[^/]*$#/racecentral_e2e#p' .env > .env.e2e   # once; .env.* is gitignored
npx vite dev --mode e2e --port 5199 --strictPort
```

Use `--mode e2e`, not `DATABASE_URL=... npx vite dev`. When `.svelte-kit` is regenerated (by `npm run check`, another dev server, or the editor), the dev server reloads its settings from `.env`, and a `DATABASE_URL` given on the command line is lost: the test server then quietly serves the real `racecentral` database. `.env.e2e` always wins over `.env`, even after a reload. **Except:** on 2026-10-24 `npm run check`, run while the test server was up, still switched it to `racecentral`, and the station API answered 401. Don't run `npm run check` while the test server is running, or restart the server afterwards.

## Demo race to watch

```bash
E2E_DATABASE_URL=$(grep '^DATABASE_URL=' .env.e2e | cut -d= -f2-) node e2e/demo-race.mjs
```

Seeds the event `demo` (a 5K and a 10K, 40 runners, Start/CP1/CP2/Finish) and uploads reads in real time, as two station laptops would, for about 20 minutes. Watch http://localhost:5199/e/demo (Progress view) and the admin. Running it again starts the race over.

## 3. Central API test (plays the station over HTTP)

In a second terminal, with `E2E` set as in step 1:

```bash
E2E_DATABASE_URL="$E2E" E2E_BASE_URL=http://localhost:5199 npm run test:e2e
```

It makes its own event (`e2e-<time>`, key `rk_e2e_<time>`) with stations Start, CP1 and Finish, category 5K and runners 101 Ana (T101), 102 Ben (T102), 103 Cara (no tag) and 104 Dan (T104), and deletes it afterwards (`E2E_KEEP=1` keeps it for inspection). It checks auth, the roster, upload/resend/void/restore, which runner a read is credited to, unknown station names, validation, heartbeat clock skew, the public results, and every fixed bug in [BUGS.md](BUGS.md), plus upgrading from older station apps and file re-imports.

Expected: **17 pass**.

## 4. Real station sync against it (Rust)

The station's live test needs an event with runners 101/T101 and 102/T102:

```bash
KEY=rk_e2e_station; HASH=$(printf %s $KEY | sha256sum | cut -d' ' -f1)
"$PSQL" "$E2E" -q <<SQL
delete from events where slug='e2e-station';
with e as (insert into events(name,slug,api_key_hash,api_key,published) values('E2E Station','e2e-station','$HASH','$KEY',true) returning id),
 s as (insert into stations(event_id,name,kind,ord) select id,'Start','start',0 from e union all select id,'Finish','finish',1 from e),
 c as (insert into categories(event_id,name) select id,'5K' from e returning id, event_id)
insert into participants(event_id,category_id,bib,name,tag) select event_id,id,'101','Ana','T101' from c union all select event_id,id,'102','Ben','T102' from c;
SQL
cd ../perstationapp/src-tauri
CENTRAL_URL=http://localhost:5199 CENTRAL_EVENT=e2e-station CENTRAL_KEY=$KEY cargo test --lib live_tests -- --ignored
```

Re-seed before each run (the test leaves its reads behind). It pulls the roster, uploads a start and a finish, voids the finish and checks the void reaches the central app, then points at a dead address and checks reads queue and the error is reported.

## 5. ESP32 -> station -> central (Rust + central checks)

With the central app running as in step 2:

```bash
E2E_DATABASE_URL="$E2E" E2E_BASE_URL=http://localhost:5199 node e2e/esp-race.mjs
```

It seeds the event `esp-demo` (Start, CP1 and Finish; a 5K; runners 101-110, where 110 has no tag), then runs `esp_readers_through_station_to_central` in `sync.rs`. That test plays three ESP32s through `db::ingest`, the code behind the station's `/ingest`, on two station laptops, and syncs both to the central app. The scenario covers an unassigned reader, a lost ACK, a lower-case tag, an unknown tag, a void, a manual entry by bib, a missed checkpoint and a power cut at the finish. The script then checks the central results, logs into the admin (password `e2e-admin-check`, set only in the `_e2e` database) and opens every page of the event.

Everything is kept in `e2e/data/`:

- `station-A-start-finish.db` and `station-B-cp1.db`: the two station databases (SQLite)
- `station-*-reads.csv` and `station-*-results.csv`: the station exports
- `central-results.json` and `central-reads.csv`: what the central app shows
- `station-checks.json` and `central-checks.json`: every check, with the expected and the actual value

Expected today: it **fails** on the open bugs BUG-7, BUG-8 and BUG-9 in [BUGS.md](BUGS.md).

## 6. Mid-race data integrity

```bash
E2E_DATABASE_URL="$E2E" E2E_BASE_URL=http://localhost:5199 node e2e/integrity.mjs
```

Event `integrity`: Start, CP1 and Finish. A 5K in two waves (bibs 101-115) and a 10K (bibs 201-210). While the station uploads reads, the test changes courses, batches, categories, bibs, runners and stations through the real admin form actions, with an update stream held open the way an LED wall would. After each step it checks:

- every runner is on the board exactly once, in the right category
- every batch belongs to the runner's own category
- no read is lost, doubled or left without a station
- every finish time equals finish minus the runner's own start gun
- open boards were told to refresh

Report: `e2e/data/integrity-report.json`. Expected: **20 / 20**. It reuses the e2e admin password from step 5. Run step 5 once first.

## Results on 2026-10-24

| Suite | Result |
|---|---|
| central unit (`npx vitest run`) | 77 / 77 pass |
| central type check (`npm run check`) | 0 errors (7 warnings, already there) |
| station unit (`cargo test`) | 30 pass, 2 ignored (the live tests) |
| central API e2e | 17 / 17 pass |
| station sync live test | pass |
| ESP32 -> station -> central | station 13 / 16, central 5 / 11: every failure is BUG-7, BUG-8 or BUG-9 |
| mid-race integrity | 20 / 20, after fixing BUG-10, BUG-11 and BUG-12 (9 / 20 before) |

## Results on 2026-10-22, after the fixes

| Suite | Result |
|---|---|
| central unit (`npx vitest run`) | 73 / 73 pass |
| central type check (`npm run check`) | 0 errors (7 warnings, already there) |
| station unit (`cargo test`) | 30 pass, 1 ignored (the live test below) |
| central API e2e | 17 / 17 pass |
| station sync live test against the central app | pass (uploads now carry `src`) |
