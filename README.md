# Race tracking

- `perstationapp/` runs on each station laptop. UHF RFID reader -> ESP32 -> WiFi -> a Tauri desktop app with a local SQLite database. It works offline.
- `centralapp/` runs on the race director's laptop. A SvelteKit app with local PostgreSQL. It registers the event and participants, receives every station's reads, and shows live results by category. See `centralapp/README.md`.

Stations upload to the central app and pull the runner list from it (Setup > Central app in the station app).
