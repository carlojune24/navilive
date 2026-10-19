# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
SvelteKit (TypeScript, adapter-node) + Tailwind v4 + shadcn-svelte. Local PostgreSQL (database `racecentral`) on the race director's laptop; live updates via Postgres LISTEN/NOTIFY over Server-Sent Events. Runs on the venue WiFi, no cloud.

## Users
- **Race director** (primary, non-developer, one shared login): registers the event, categories, participants with bib numbers, stations, and the station API key; watches results come in. Works at a laptop at or near the finish, under time pressure when a pack arrives.
- **Viewers of the live board**: the director and anyone at the finish area, mainly on a big screen (projector or TV) at the finish line. Phones on the same WiFi are secondary.
- **Station laptops** (machine clients, not people): pull the participant roster and push tag reads through the API.

## Product Purpose
Central hub for a timed race. The director registers an event and its participants by category with bib numbers. Each station's app (perstationapp: RFID reader, ESP32, local SQLite) pulls the roster and uploads reads. The hub merges every station's reads and shows live results by category. Success: results appear within seconds of a read, nothing is lost or duplicated, and the director trusts the numbers.

## Positioning
Local-first race results hub: runs on the director's own laptop and venue WiFi, stays correct when stations upload late or twice (idempotent ingest), and never needs the internet.

## Operating Context
Outdoor event, bright daylight, one laptop hosting the app, station laptops uploading over WiFi, a big screen at the finish. The laptop must stay on and reachable on the venue network. Database backup via pg_dump before the event.

## Capabilities and Constraints
- Events, categories, participants (bib, name, category, RFID tag; CSV import with the same columns as perstationapp), stations (start/checkpoint/finish).
- API: station pulls participants; station pushes read batches with a per-event API key (stored hashed, shown once). Re-uploads never duplicate.
- Live board per category: rank, bib, name, finish time. Per-checkpoint splits on demand. Elapsed time comes from the start station read.
- Public board URL per event (`/e/:slug`); admin behind one shared login.
- Not in v1: online registration/payments, age-group auto-assignment, multiple admin accounts, notifications.

## Evidence on Hand
Station app and its reader data model in `../perstationapp` (runners/reads/stations tables, results logic in `src-tauri/src/db.rs`). No real event data or participant lists yet; do not fabricate names or times beyond clearly labeled sample data.

## Product Principles
1. Never lose or silently alter a read; voiding is allowed, deleting is not.
2. The live board is legible from across a finish line: rank, bib, time first.
3. Honest status: show when stations last reported and whether the feed is live or stale.
4. The director can run the whole event without a developer.

## Accessibility & Inclusion
Readable in direct sunlight and on a distant projector (high contrast, large type); color never the only signal; keyboard-operable admin.
