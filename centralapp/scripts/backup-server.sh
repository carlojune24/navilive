#!/bin/bash
# Nightly database backup for Race Central. Keeps the 14 newest.
set -euo pipefail
cd /home/ubuntu/apps/race-central
set -a; . ./.env; set +a
mkdir -p /home/ubuntu/backups
f=/home/ubuntu/backups/race-central-$(date +%Y%m%d-%H%M%S).dump
pg_dump -Fc "$DATABASE_URL" -f "$f"
ls -1t /home/ubuntu/backups/race-central-*.dump | tail -n +15 | xargs -r rm --
echo "saved $f"
