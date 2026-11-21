#!/bin/bash
# A fresh throwaway database racecentral_qa (same server as .env's DATABASE_URL) with every migration applied twice
# (deploys re-run them all), then a production build.
set -e
cd "$(dirname "$0")/.."
U=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r'); BASE=${U%/*}
psql "$BASE/postgres" -qc "drop database if exists racecentral_qa" 2>/dev/null
psql "$BASE/postgres" -qc "create database racecentral_qa"
for pass in 1 2; do for f in db/*.sql; do PGOPTIONS='--client-min-messages=warning' psql "$BASE/racecentral_qa" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done; done
npx vite build >/dev/null 2>&1
echo "racecentral_qa + build ready"
