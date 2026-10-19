# Race Tracker (esp32wiegandrfidreader)

Tauri v2 desktop app for tracking runners from start to checkpoints to finish.

```
R16-7DB UHF reader --RS232--> MAX3232 module --UART--> ESP32 --WiFi/HTTP--> Race Tracker app --> SQLite
```

Backend: Rust + rusqlite (bundled SQLite, WAL, `synchronous=FULL`). Frontend: Vite + React + Tailwind + shadcn/ui.

## Run

```
npm install
npm run dev        # tauri dev
npm run build      # installer in src-tauri/target/release/bundle
cd src-tauri && cargo test    # data-integrity tests
```

Windows Firewall: allow the app on **Private** networks (port **4390**) or the ESP32 cannot reach it.

## One laptop per station

Each laptop runs its own copy with its own database. Point each station's ESP32 at that laptop. For final results:
Setup -> Data -> **Export this station** on every laptop, copy the `.json` files to one laptop, **Import** them there.
Importing is idempotent (reads are deduplicated by device + boot + sequence), so importing twice or re-importing
a later export never double-counts. Stations are matched by name, so name them identically everywhere.

## How "no data discrepancy" is enforced

| Risk | Protection |
|---|---|
| WiFi drops / app closed | ESP32 journals every read to flash first, resends until the app answers HTTP 200 |
| App crash mid-write | 200 is sent only after the SQLite transaction committed (`synchronous=FULL`) |
| Lost acknowledgement -> resend | Unique key `(device_id, boot_id, seq)`; `INSERT OR IGNORE`, so no duplicates |
| ESP32 reboot restarts counters | `boot_id` is random per boot, so a restarted `seq` is never mistaken for a duplicate |
| Reader spams one tag | ESP32 suppresses repeats for 1 s; the app keeps all raw reads and counts only the first per tag+station inside the debounce window (default 30 s) as a *passing* |
| Wrong read | Void / restore only. Reads are never deleted; voiding the first read promotes the next one |
| Time accuracy | ESP32 sends each read's age at send time, so network delay does not shift the time. Reads recovered after a reboot are flagged "Late time" (arrival time used) |
| Disk loss | Auto-backup every 5 min (6 rotating copies) + manual backup (Setup -> Data) |
| Station deleted by mistake | Stations that have reads cannot be deleted |

Data lives in `%APPDATA%\com.carlo.esp32wiegandrfidreader\` (`race.db`, `backups\`, `exports\`).

## ESP32

Sketch: `esp32/race_reader_node/race_reader_node.ino` (Arduino IDE, libraries: **WiFiManager** by tzapu; board "ESP32 Dev Module").
It replaces the Wiegand/MQTT plan in `reference/ESP32_Wiegand_RFID_MQTT_Guide.md`: RS232 is used instead of Wiegand,
and HTTP with acknowledgement instead of MQTT (no broker to run, and delivery is confirmed by the database commit).

Wiring (MAX3232 module powered from 3V3):

| MAX3232 module | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| TXD (from reader) | GPIO16 (RX2) |
| RXD (to reader) | GPIO17 (TX2) |

DB9 goes to the reader's RS232 port. These labels were verified working on the tested module; if another module shows nothing, swap the two data wires or use a null-modem cable. The reader has its own 9-12 V supply.

First boot: join WiFi network `RaceReader-XXXX`, choose the race WiFi, optionally enter the laptop's IP
(shown in Setup -> Connection; leave blank to auto-discover `racetracker.local`) and the reader's baud rate.

### Calibrating the reader (needs one test)

The R16-7DB's RS232 baud and frame format are not documented in the files given. In the Serial Monitor (115200) type `raw`,
present a tag, and the node prints every frame in hex. Use `baud 115200` (or 9600, 57600...) until frames look sane.
If the frame has a header/checksum or the tag id is a slice of it, send me one sample and I will add the parser;
until then the app stores the full frame as the tag, which is already unique per tag and mappable to a bib in Runners.

## Status

- Rust backend: compiled, 11 integrity tests pass, ingest endpoint verified end-to-end with simulated ESP32 posts
  (resend, reboot, heartbeat, malformed body).
- UI: running and checked in the real Tauri window.
- ESP32 firmware: **not compiled or run on hardware** in this environment. Treat first flash as a bench test before race day.
