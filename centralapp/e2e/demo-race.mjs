// Demo race for watching the live board: seeds event "demo" (5K + 10K, 40 runners, 4 stations) in the _e2e database and
// uploads reads in real time through the station API, as two station laptops would, with heartbeats.
//   E2E_DATABASE_URL=postgres://.../racecentral_e2e E2E_BASE_URL=http://localhost:5199 node e2e/demo-race.mjs
// The 10K started 40 min ago and the 5K 20 min ago, so the board fills at once and finishes keep arriving for ~20 min.
// Included on purpose: a missed checkpoint (203), two runners who drop out (115, 218), a runner without a tag entered by
// bib at the finish (120), a double read the station voids (105), and reads under a misspelled station name.
import { createHash } from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5199';
const DB_URL = process.env.E2E_DATABASE_URL;
if (!DB_URL || !/_e2e$/.test(new URL(DB_URL).pathname)) throw new Error('E2E_DATABASE_URL must point at a database whose name ends in _e2e');
const SLUG = 'demo';
const KEY = 'rk_demo_key';
const MIN = 60_000;

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

// ---- seed
await db.query('delete from events where slug=$1', [SLUG]);
const ev = await one('insert into events(name, slug, api_key_hash, api_key, award_places, published) values($1,$2,$3,$4,3,true) returning id', ['Navi Demo Run 2026', SLUG, createHash('sha256').update(KEY).digest('hex'), KEY]);
const st = {};
for (const [i, [name, kind]] of [['Start', 'start'], ['CP1', 'checkpoint'], ['CP2', 'checkpoint'], ['Finish', 'finish']].entries())
	st[name] = (await one('insert into stations(event_id,name,kind,ord) values($1,$2,$3,$4) returning id', [ev.id, name, kind, i])).id;
const course = { '5K': [['Start', 0], ['CP1', 2.5], ['Finish', 5]], '10K': [['Start', 0], ['CP1', 2.5], ['CP2', 5], ['Finish', 10]] };
const cat = {};
for (const [name, stops] of Object.entries(course)) {
	cat[name] = (await one('insert into categories(event_id,name) values($1,$2) returning id', [ev.id, name])).id;
	for (const [i, [s, km]] of stops.entries()) {
		await db.query('insert into category_courses(category_id,station_id,ord) values($1,$2,$3)', [cat[name], st[s], i]);
		if (km) await db.query('insert into category_station_km(category_id,station_id,km) values($1,$2,$3)', [cat[name], st[s], km]);
	}
}
const NAMES = ['Ana Reyes', 'Ben Cruz', 'Carla Santos', 'Dan Lopez', 'Ella Garcia', 'Felix Ramos', 'Gina Torres', 'Hugo Flores', 'Iris Mendoza', 'Jon Navarro',
	'Kara Castillo', 'Leo Bautista', 'Mia Aquino', 'Nico Villanueva', 'Olga Dela Cruz', 'Paolo Rivera', 'Quinn Morales', 'Rosa Fernandez', 'Sam Gonzales', 'Tina Domingo'];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); // repeatable, so every run tells the same race
const runners = [];
for (const [c, first] of [['5K', 101], ['10K', 201]])
	for (let i = 0; i < 20; i++) {
		const bib = String(first + i);
		const r = { bib, cat: c, name: NAMES[(i + (c === '10K' ? 7 : 0)) % 20], gender: i % 2 ? 'M' : 'F', age: 16 + Math.floor(rnd() * 50), tag: bib === '120' ? '' : `E2000${bib}` };
		runners.push(r);
		await db.query('insert into participants(event_id,category_id,bib,name,tag,gender,age) values($1,$2,$3,$4,$5,$6,$7)', [ev.id, cat[c], bib, r.name, r.tag, r.gender, r.age]);
	}

// ---- the race: who passes which station when
const now = Date.now();
const gun = { '10K': now - 40 * MIN, '5K': now - 20 * MIN };
const device = { Start: 'ESP-START', CP1: 'ESP-CP1', CP2: 'ESP-CP2', Finish: 'ESP-FINISH' };
const laptopOf = { Start: 'L-STARTFIN', Finish: 'L-STARTFIN', CP1: 'L-COURSE', CP2: 'L-COURSE' };
const seq = {};
const reads = [];
const add = (station, tag, at, extra = {}) => {
	const dev = extra.device_id ?? device[station];
	seq[dev] = (seq[dev] ?? 0) + 1;
	reads.push({ station, tag, read_at_ms: Math.round(at), device_id: dev, voided: false, src: `${dev === 'MANUAL' ? 'manual-L-STARTFIN' : 'boot1'}:${seq[dev]}`, ...extra });
};
for (const r of runners) {
	const pace = (r.cat === '5K' ? 3.6 + rnd() * 3.2 : 3.6 + rnd() * 2.6) * MIN; // per km
	const start = gun[r.cat] + rnd() * 40_000; // crossing the start mat a little after the gun
	for (const [s, km] of course[r.cat]) {
		if (r.bib === '203' && s === 'CP1') continue; // missed checkpoint: flagged on the admin Progress page
		if ((r.bib === '115' || r.bib === '218') && km > 2.5) break; // dropped out after CP1
		const at = start + km * pace * (0.95 + rnd() * 0.1);
		if (!r.tag && s === 'CP1') continue; // no tag: nothing reads them on the course; start and finish are entered by bib
		add(s, r.tag || r.bib, at, r.tag ? {} : { device_id: 'MANUAL', bib: r.bib });
		if (r.bib === '105' && s === 'Finish') add(s, r.tag, at + 1500); // a double read the station voids a minute later
	}
}
add('Finsh', 'E2000207', gun['10K'] + 30 * MIN, { device_id: 'ESP-SPARE' }); // a laptop with a misspelled station name
reads.sort((a, b) => a.read_at_ms - b.read_at_ms);
const voidLater = reads.find((r) => r.tag === 'E2000105' && r.station === 'Finish' && reads.some((o) => o !== r && o.tag === r.tag && o.station === 'Finish' && o.read_at_ms < r.read_at_ms));

// ---- live feed
const post = (path, body) => fetch(`${BASE}/api/events/${SLUG}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
const sent = new Set();
let voided = false;
const lastRead = {};
console.log(`Demo event ready: ${BASE}/e/${SLUG}   admin: ${BASE}/admin/${SLUG}   ${reads.length} reads planned`);
for (;;) {
	const t = Date.now();
	const due = reads.filter((r) => !sent.has(r) && r.read_at_ms <= t);
	for (const laptop of ['L-STARTFIN', 'L-COURSE']) {
		const mine = due.filter((r) => (laptopOf[r.station] ?? 'L-STARTFIN') === laptop);
		if (mine.length) {
			const res = await post('/reads', { reads: mine });
			if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
			mine.forEach((r) => (sent.add(r), (lastRead[r.station] = r.read_at_ms)));
		}
		const stations = Object.entries(laptopOf).filter(([, l]) => l === laptop).map(([name]) => ({ name, kind: name === 'Start' ? 'start' : name === 'Finish' ? 'finish' : 'checkpoint', readers_total: 1, readers_online: 1, last_read_ms: lastRead[name] ?? null, pending: 0 }));
		await post('/heartbeat', { laptop_id: laptop, laptop_name: laptop === 'L-STARTFIN' ? 'Start/Finish laptop' : 'Course laptop', app_version: '0.1.0', now_ms: Date.now(), pending: 0, last_error: '', stations });
	}
	if (voidLater && sent.has(voidLater) && !voided && t - voidLater.read_at_ms > MIN) {
		await post('/reads', { reads: [{ ...voidLater, voided: true }] });
		voided = true;
		console.log('station voided the double read of bib 105');
	}
	if (due.length) console.log(`${new Date().toLocaleTimeString()}  +${due.length} reads (${sent.size}/${reads.length}): ${due.map((r) => `${r.tag.replace('E2000', '')}@${r.station}`).join(', ')}`);
	if (sent.size === reads.length && voided) break;
	await new Promise((ok) => setTimeout(ok, 5000));
}
console.log('All reads sent. Race over.');
await db.end();
