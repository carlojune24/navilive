#!/bin/bash
# End-to-end QA against a throwaway database: drives the real server over HTTP like the admin, station laptops,
# marshal phones and the public board do. Never touches .env's own database. Takes about 1 minute.
cd "$(dirname "$0")/.."
bash qa/reset.sh || exit 1
U=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r')
DATABASE_URL="${U%/*}/racecentral_qa" ADMIN_PASSWORD='qa-admin-pass-123' PORT=5299 node build > qa/server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for i in $(seq 1 20); do curl -s -o /dev/null http://localhost:5299/login && break; sleep 1; done
fail=0
# p4 goes last: its brute-force check locks this address out of the admin for 10 minutes
for p in p1_setup p2_race p3_marshal_security p5_mustfix p6_start_warning p4_load; do
  node "qa/$p.mjs" > qa/last.log 2>&1 || { fail=1; echo "$p FAILED or crashed:"; tail -5 qa/last.log; }
  grep -E "^FAIL|passed" qa/last.log
done
[ $fail = 0 ] && echo "QA: all checks passed" || { echo "QA: FAILURES (server log: qa/server.log)"; exit 1; }
