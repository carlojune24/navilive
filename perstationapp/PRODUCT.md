# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Tauri v2 desktop app (Windows). Backend: Rust + rusqlite (SQLite). Frontend (user-specified): Vite + React + TypeScript + Tailwind CSS + shadcn/ui, served as static `dist` into the Tauri webview.

## Users
A race operator staffing one station (start, a checkpoint, or finish) with one laptop, outdoors under a tent/table in daylight, with runners streaming past. Glance-and-go: they must see "tag read / runner X passed" instantly and trust the numbers. A race director later merges every station's data for results. Non-developers.

## Product Purpose
Track runners from start through checkpoints to finish. A UHF RFID reader (R16-7DB) on RS232 feeds an ESP32 (via a MAX3232 level shifter), which sends each tag read over WiFi to this app. The app stores every read in SQLite and shows live reads, runners, per-station passings and results. Success: zero lost or duplicated data across a whole event, and fast visible confirmation of each read.

## Positioning
Offline, LAN-only, no cloud or broker: an ESP32 retries with acknowledgement until the SQLite commit succeeds, so no read is lost on WiFi drops or reboots; raw reads are never deleted, only voided.

## Operating Context
One laptop per station, each with its own database; ESP32 posts to the laptop's IP (port 4390). Results across stations are merged by exporting/importing reads between laptops (deduplicated by device + boot + sequence). Bright outdoor light, possible time pressure when a pack arrives.

## Capabilities and Constraints
- Live read feed with beep and big last-read card.
- Runners (bib, name, category, tag mapping, CSV import), stations (start/checkpoint/finish), devices (ESP32 online status, queue depth, assign to station).
- Passings with debounce window, void/unvoid (never delete), manual entry for missed tags, results with elapsed time.
- Export CSV, backup DB, export/import reads for cross-station merge.
- Reader RS232 baud and frame format not yet known; app shows raw frames for calibration.

## Product Principles
1. Never lose or silently alter data; every action is auditable and reversible.
2. The newest read is the loudest thing on screen.
3. Operate first: big targets, tabular numbers, no decoration that costs scanability.
4. Honest status: always show whether the reader/ESP32/server are connected.

## Accessibility & Inclusion
Readable in direct sunlight (high contrast, large type), color never the only signal, keyboard-operable.
