// ESP32 -> station app -> central app, end to end. Seeds the event "esp-demo" in the _e2e database, runs the station's
// esp_readers_through_station_to_central test (sync.rs) against it, then checks what the central app shows and logs into
// the admin to open every page of the event. Everything is kept in e2e/data/ for inspection. See e2e/README.md.
//   E2E_DATABASE_URL=postgres://.../racecentral_e2e E2E_BASE_URL=http://localhost:5199 node e2e/esp-race.mjs
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5199';
const DB_URL = process.env.E2E_DATABASE_URL;
if (!DB_URL || !/_e2e$/.test(new URL(DB_URL).pathname)) throw new Error('E2E_DATABASE_URL must point at a database whose name ends in _e2e');
const SLUG = 'esp-demo';
const KEY = 'rk_esp_demo';
const ADMIN_PW = 'e2e-admin-check'; // only for the _e2e database; delete its app_settings row to go back to the .env password
const DATA = fileURLToPath(new URL('./data/', import.meta.url));
mkdirSync(DATA, { recursive: true });

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

// ---- seed: Start / CP1 / Finish, one 5K, runners 101-110 (110 has no tag and is entered by bib)
await db.query('delete from events where slug=$1', [SLUG]);
const ev = await one('insert into events(name, slug, api_key_hash, api_key, award_places, published) values($1,$2,$3,$4,3,true) returning id', ['ESP Station Test Run', SLUG, createHash('sha256').update(KEY).digest('hex'), KEY]);
const st = {};
for (const [i, [name, kind]] of [['Start', 'start'], ['CP1', 'checkpoint'], ['Finish', 'finish']].entries())
	st[name] = (await one('insert into stations(event_id,name,kind,ord) values($1,$2,$3,$4) returning id', [ev.id, name, kind, i])).id;
const cat = (await one("insert into categories(event_id,name) values($1,'5K') returning id", [ev.id])).id;
for (const [i, [s, km]] of [['Start', 0], ['CP1', 2.5], ['Finish', 5]].entries()) {
	await db.query('insert into category_courses(category_id,station_id,ord) values($1,$2,$3)', [cat, st[s], i]);
	if (km) await db.query('insert into category_station_km(category_id,station_id,km) values($1,$2,$3)', [cat, st[s], km]);
}
const NAMES = ['Ana Reyes', 'Ben Cruz', 'Carla Santos', 'Dan Lopez', 'Ella Garcia', 'Felix Ramos', 'Gina Torres', 'Hugo Flores', 'Iris Mendoza', 'Jon Navarro'];
for (let i = 0; i < 10; i++) {
	const bib = String(101 + i);
	await db.query('insert into participants(event_id,category_id,bib,name,tag,gender,age) values($1,$2,$3,$4,$5,$6,$7)', [ev.id, cat, bib, NAMES[i], bib === '110' ? '' : `E2000${bib}`, i % 2 ? 'M' : 'F', 20 + i * 4]);
}
console.log(`seeded ${BASE}/e/${SLUG}`);

// ---- the station side
const cargo = spawnSync('cargo', ['test', '--lib', 'esp_readers_through_station_to_central', '--', '--ignored', '--nocapture'], {
	cwd: fileURLToPath(new URL('../../perstationapp/src-tauri/', import.meta.url)),
	env: { ...process.env, CENTRAL_URL: BASE, CENTRAL_EVENT: SLUG, CENTRAL_KEY: KEY, STATION_DB_DIR: DATA },
	encoding: 'utf8'
});
const stationOk = cargo.status === 0;
if (!stationOk) console.log((cargo.stdout + cargo.stderr).split('\n').filter((l) => /checks failed|panicked|error/.test(l)).join('\n'));

// ---- the central side
const checks = [];
const check = (name, expected, actual) => checks.push({ check: name, ok: JSON.stringify(expected) === JSON.stringify(actual), expected, actual });
const t = JSON.parse(readFileSync(DATA + 'expected-times.json', 'utf8'));
const res = await (await fetch(`${BASE}/e/${SLUG}/results`)).json();
writeFileSync(DATA + 'central-results.json', JSON.stringify(res, null, 2));
const c5 = res.categories.find((c) => c.name === '5K');
const finishAt = Object.fromEntries(c5.rows.map((r) => [r.bib, r.finishAt]));
const n = async (sql) => Number((await one(sql.replace('$EV', ev.id))).n);

check('central: start reads (9 ESP + 1 manual)', 10, await n(`select count(*) n from reads where event_id=$EV and station_id=${st.Start}`));
check('central: CP1 reads', 8, await n(`select count(*) n from reads where event_id=$EV and station_id=${st.CP1}`));
check('central: every read has an identity (src)', 0, await n("select count(*) n from reads where event_id=$EV and src=''"));
check('central: unknown tag stored, matched to nobody', [{ tag: 'E2009999', bib: null }], (await db.query('select tag, bib from reads where event_id=$1 and tag=$2', [ev.id, 'E2009999'])).rows);
check('central: 103 has exactly one counted finish read', 1, await n(`select count(*) n from reads where event_id=$EV and station_id=${st.Finish} and tag='E2000103' and not voided`));
check('central: all 10 runners finished', ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'], c5.rows.map((r) => r.bib).sort());
check('central: 109 missed CP1, so has no CP1 split', [], c5.rows.find((r) => r.bib === '109')?.splits ?? 'not a finisher');
check('central: 106 and 107 finish at the time they crossed', [t.t106, t.t107], [finishAt['106'] ?? null, finishAt['107'] ?? null]);
check('central: 108 and 109 finish at the time they crossed', [t.t108, t.t109], [finishAt['108'] ?? null, finishAt['109'] ?? null]);

// ---- admin: log in (the flow that gave a 500 on an unmigrated database) and open every page of the event
const salt = randomBytes(16);
const hash = ['scrypt', 2 ** 15, 8, 1, salt.toString('base64'), scryptSync(ADMIN_PW, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 2 ** 26 }).toString('base64')].join('$');
await db.query("insert into app_settings(key,value) values('admin_password_hash',$1) on conflict(key) do nothing", [hash]);
let cookie = null;
for (let i = 0; i < 40 && !cookie; i++) {
	// the server caches the password hash for 30 s
	const r = await fetch(`${BASE}/login`, { method: 'POST', redirect: 'manual', headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${ADMIN_PW}` });
	cookie = r.headers.get('set-cookie')?.split(';')[0] ?? null;
	if (!cookie) await new Promise((ok) => setTimeout(ok, 1000));
}
check('admin: login with the right password sets a session', true, !!cookie);
const pages = ['/admin', `/admin/${SLUG}`, `/admin/${SLUG}/export?kind=results`, `/admin/${SLUG}/export?kind=reads`, `/admin/${SLUG}/station/${st.Finish}`, `/admin/guide`, `/admin/account`, `/e/${SLUG}`, `/e/${SLUG}/map`];
const status = {};
for (const p of pages) {
	const r = await fetch(BASE + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });
	status[p] = r.status;
	if (p.includes('kind=reads') && r.ok) writeFileSync(DATA + 'central-reads.csv', await r.text());
}
check('admin: every page answers 200', Object.fromEntries(pages.map((p) => [p, 200])), status);

writeFileSync(DATA + 'central-checks.json', JSON.stringify(checks, null, 2));
const station = JSON.parse(readFileSync(DATA + 'station-checks.json', 'utf8'));
for (const [side, list] of [['station', station], ['central', checks]]) {
	console.log(`\n${side}: ${list.filter((c) => c.ok).length}/${list.length} checks pass`);
	for (const c of list) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.check}${c.ok ? '' : `\n        expected ${JSON.stringify(c.expected)}\n        actual   ${JSON.stringify(c.actual)}`}`);
}
await db.end();
process.exitCode = stationOk && checks.every((c) => c.ok) ? 0 : 1;
