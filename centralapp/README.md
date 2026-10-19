# Race Central

The central app for a timed event. The race director registers the event, categories, participants and bib numbers here. Every station laptop (`../perstationapp`) uploads its reads. Everyone watches live results by category at `/e/<event>`.

Runs on the director's laptop with local PostgreSQL. No internet needed.

## Hosted deployment (current setup)

The app runs on the OVH server at **https://navilive.duckdns.org** (admin: `/admin`, live board: `/e/<event>`).

- **How it runs:** Node app on `127.0.0.1:3100`, systemd service `race-central`, behind nginx (site `race-central`) with a Let's Encrypt certificate from certbot (auto-renews), the same way dashprotec is set up. Folder: `/home/ubuntu/apps/race-central`. Settings and secrets: `/home/ubuntu/apps/race-central/.env` (`ADMIN_PASSWORD`, `DATABASE_URL`, `PUBLIC_URL`).
- **Database:** `racecentral` in the server's PostgreSQL, owned by its own user. Nightly backup at 03:15 to `/home/ubuntu/backups` (14 kept).
- **Shared server:** order-tracking (port 3000), dashprotec, WashSuite (8090) and others live here too. Do not change their ports, nginx sites or databases.
- **Stations:** in the station app, Setup > Central app, paste the connection code from the event's Connect page (the address is `https://navilive.duckdns.org`).
- **Login protection:** 5 wrong passwords block that address for 10 minutes.
- **Admin password:** change it on the **Password** page in the admin (left menu). It is stored hashed in the database and signs out other sessions. Until you change it, `ADMIN_PASSWORD` in the server `.env` is the password.
- **Forgot the admin password:** on the server run `cd ~/apps/race-central && set -a && . ./.env && set +a && psql "$DATABASE_URL" -c "delete from app_settings where key='admin_password_hash'"`. The `ADMIN_PASSWORD` from `.env` works again within 30 seconds, then change it on the Password page.

**Update the app** with one command, from the `centralapp` folder:

```powershell
npm run deploy          # type check + tests, build, upload, backup, restart, health check
npm run deploy -- -Quick   # skip the type check and tests
```

It asks for the server password twice. To stop being asked, run `.\scripts\setup-ssh-key.ps1` once (creates an SSH key on your laptop and adds its public half to the server). Safety built in: it backs up the database before every deploy, keeps the previous build, and if the new version does not start within 20 seconds it puts the previous one back and tells you. The `.env` file is never uploaded. Database changes in `db\*.sql` run on every deploy, so write them idempotently (`create ... if not exists`, `add column if not exists`).

(Why it builds on your laptop: the server's npm is older than the lockfile.) Anything else on the server, such as order-tracking, dashprotec and WashSuite, is left alone.

Logs on the server: `journalctl -u race-central -f`. Change the admin password: edit `ADMIN_PASSWORD` in the server `.env`, then restart the service.

The sections below describe running it on a laptop instead (leave `PUBLIC_URL` unset and build without it).

## One-time setup (this laptop)

1. **Database.** PostgreSQL must be running with a database called `racecentral`. Create the tables once:
   ```powershell
   $env:PGPASSWORD='<postgres password>'
   Get-ChildItem db\*.sql | Sort-Object Name | ForEach-Object { & 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h localhost -d racecentral -v ON_ERROR_STOP=1 -f $_.FullName }
   ```
2. **`.env`** in this folder (never commit it):
   ```
   DATABASE_URL=postgres://postgres:<password>@localhost:5432/racecentral
   ADMIN_PASSWORD=<choose a real password>
   HOST=0.0.0.0
   PORT=3000
   ```
3. **Install and build:** `npm install` then `npm run build`.
4. **Firewall.** In an *Administrator* PowerShell, once: `.\scripts\firewall.ps1`. Station laptops and phones cannot reach the app without it. It allows the port on **Private** networks only, so make sure the venue WiFi is set to Private (the script prints how).

## Event day

```powershell
.\scripts\start.ps1
```

It prints two kinds of address:

| Who | Address |
| --- | --- |
| Director (this laptop) | `http://localhost:3000/admin` |
| Station laptops, phones, big screen | `http://<this laptop's IP>:3000` |

**Use `localhost` for the admin pages.** Forms are only accepted from `http://localhost:3000`. Everything else (live board, station uploads) works from any device.

### Setting up the event

1. Sign in at `/admin` and create the event. The event gets an **API key**, shown on the Connect page whenever you need it (Rotate key makes a new one).
2. **Categories**, then **Import participants** (the button on the Participants page opens a dialog). Three ways, all matching the Participants page (bib, name, category, gender, age, tag):
   - *Bib numbers into a category*: pick a category, paste bibs (`101-150`, `201`, one per line), optionally set a gender for all of them. Names and ages can come later.
   - *Full detail (CSV)*: **one file per category**. Choose the category from the list in the dialog (or "Don't change categories" to only update details), then upload a file with a header row: `bib` (required) and optionally `name`, `gender` (M/F), `age`, `tag`, plus any other columns (kept as extra data). **Download template** gives the exact layout. **Download current participants** gives the list, including each runner's category, to edit in Excel and import back (a category written in a file wins over the list). Re-importing updates by bib and never blanks existing data.
   - *Add one runner*: a form with every field, for walk-up registrations.
3. **Stations**: Start and Finish exist already; add checkpoints. **Names must match the station app exactly.**

### Connecting each station laptop

Open the event's **Connect** page. It shows this laptop's address (pick the one on the venue WiFi), the event name and the API key, and a single **connection code** with a Copy button.

In the station app: **Setup > Central app**, paste the code, press *Fill from code*, then *Save and connect*. The runner list downloads and reads upload every 5 seconds. If the connection drops, reads queue on the station laptop and upload when it returns.

### Heartbeat: are the station laptops connected?

Each station app sends a small "I'm alive" message to the central app every 5 seconds (even when no tags are being read), carrying the laptop's name (set in the station app: Setup > Central app > *This laptop's name*, otherwise the computer name), its stations, how many readers are online, how many reads are waiting to upload, any error it is having, and its clock.

The **Station data** page shows them live, with no refresh, in a **Station laptops** panel: **Online** (a heartbeat in the last 15 seconds), **Late** (15 to 45 seconds) and **Offline** (longer), plus per station: readers online, reads waiting, last read. It warns if a laptop's clock differs from the server by more than 2 seconds, because race times are taken from each laptop's own clock. The **Stations** page shows each station's link status, and the left menu shows "n of m laptops online" (red when one is offline). A central app that has not been updated simply ignores the heartbeat, and an old station app just does not appear in the laptop list.

### Seeing what each station sent

The **Station data** page lists every station with its read count, how many different runners, voided reads, tags that match no participant, when data last arrived and which devices sent it. **View reads** opens that station's own page (search by bib, name or tag; it refreshes by itself). If a station laptop sends a name that is not on the Stations page, a red box lists those reads, which do not count until you add that station, and **Add as station** does it in one click and recovers the reads already received.

### Corrections, edits and exports

- **Participants** page: a **Search** box (bib, name, tag, gender, age; several words must all match) and a **Category** filter narrow the list instantly, and *Edit* changes bib, name, category, gender, age and tag. Renumbering a bib keeps its reads attached.
- **Reads** page: void or restore any read, add a read by hand (missed tag, or testing before the event), or *Clear all reads* (type `CLEAR`) to wipe test data. Reads are otherwise never deleted. A void made here is not sent back to the station apps.
- **Export** page: results as CSV (gun time or own start, with checkpoint splits) and the raw log of every read.

### Station order, courses and progress

On the **Stations** page, put the checkpoints in order with Up/Down (start is always first, finish last). Below the list, **Course per category** says which stations each category passes; by default every category passes every station, and a shorter category (for example the 5K) can skip a checkpoint. The **Progress** page (and the board's **Progress** view) shows, per category, who has reached which station. A runner with a later read but none at an earlier station on their course is flagged **Missed: <station>** for you (not on the public board); their result is kept, and you can add the missing read on the Reads page.

### Winners and awards

Categories are distances (5K, 10K). Winners are picked **inside each category**, from the runners' gender and age (enter them in the CSV import, the Add one runner form, or the Edit form). The **Awards** page decides who gets which prize:

- **Per category checkboxes:** Overall, Men, Women, Youngest finisher, Oldest finisher, and its own number of places.
- **Age group awards:** tick it, then edit the brackets for that category (from, to, "and over" if To is empty), and choose per bracket whether to award Men, Women and/or Everyone. Without edits a category uses the event's default brackets.
- **Custom awards:** name an award and filter by gender, an age range, and any extra CSV column such as `team` or `club` ("team is equal to Runners Club"), with its own places, for all categories or only some.
- **Event defaults:** places, default brackets, whether overall winners may also take an age-group prize, and whether to show Men/Women even in a single-gender category.
- **Reveal switch:** *Hide until the ceremony* keeps awards off the public board ("Awards coming soon") while you still see them on the Awards page and in the winners export. *Reveal awards now* shows them, and open boards update by themselves.
- **Who wins what right now:** a preview at the bottom of the page for the saved settings.

Nothing configured means all standard awards are on, the same as before. The live board's **Results / Awards** switch shows the podiums, and the Export page has a winners CSV plus gender and age-group ranks in the results CSV (using each category's own brackets).

### Live board

`/e/<event>` shows one category at a time. **Gun time** counts from the first start read in the category (mass or wave start); **Own start** counts from each runner's own start read. **Big screen** (or `?kiosk`) hides the controls and cycles categories. Pick the pace with *Switch every* (5 to 60 seconds); the Big screen button carries it, or bookmark `/e/<event>?kiosk&cycle=20`.

### Live board look, photos and movement

- **Places:** each category's prize places (its *Places* setting on the Awards page, for example 3 or 5) are shown large; everyone after that is shown in smaller type. The first three get a gold, silver and bronze trophy.
- **Movement:** when a finish changes the order, rows slide to their new places and a new finisher slides in. Systems set to "reduce motion" get no animation.
- **Winner photos:** on the Awards page, the *Winner photos* section lists everyone who wins something; press *Upload photo* (any phone photo works, it is shrunk to 640 px in the browser first) or use the *Edit* form on the Participants page. Photos appear next to the prize places on the board and in the award cards. They are stored in the database (so backups include them), only JPG, PNG and WebP are accepted, and the file type is checked from the file's contents.

## Backups

```powershell
.\scripts\backup.ps1      # saves backups\racecentral-<time>.dump
```

Do this before the event and after the finish. Restore: `pg_restore -U postgres -h localhost -d racecentral --clean <file>`.

## Development

`npm run dev` (port 5173), `npm run check`, `npx vitest run`.

## Known limits

- One shared admin password; no per-user accounts.
- If you change `PORT`, also change the origin in `vite.config.ts` and rebuild.
- The board ranks by the first finish read after the start read. In Own start mode, a runner with no start read is not ranked.
- The database setup commands in step 1 are safe to run again.
