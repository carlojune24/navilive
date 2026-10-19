#!/bin/bash
# Runs ON THE SERVER, started by deploy.ps1 (it is read straight out of the uploaded package).
# Backs up the database, swaps in the new build, applies db/*.sql, restarts, and rolls back if the new build does not start.
set -euo pipefail
APP_DIR="${APP_DIR:-/home/ubuntu/apps/race-central}"
PKG="$HOME/race-central-deploy.tar.gz"
cd "$APP_DIR"

echo '-- backing up the database first'
bash scripts/backup-server.sh

echo '-- unpacking (previous build kept for rollback)'
rm -rf build.prev
[ -d build ] && mv build build.prev
tar -xzf "$PKG"
rm -f "$PKG"
npm install --omit=dev --ignore-scripts --no-audit --no-fund --silent

echo '-- applying database changes'
set -a; . ./.env; set +a
for f in db/*.sql; do
  PGOPTIONS='--client-min-messages=warning' psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null
  echo "   applied $(basename "$f")"
done

echo '-- restarting'
sudo -n systemctl restart race-central
ok=0
for i in $(seq 1 20); do
  sleep 1
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/login)" = "200" ]; then ok=1; break; fi
done

if [ "$ok" != "1" ]; then
  echo 'NEW VERSION DID NOT START - rolling back to the previous build'
  rm -rf build
  mv build.prev build
  sudo -n systemctl restart race-central
  sleep 3
  journalctl -u race-central -n 15 --no-pager || true
  exit 1
fi
echo 'new version is running'
