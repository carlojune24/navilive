// End-to-end test of the station API (what perstationapp/src-tauri/src/sync.rs talks to) against a running central app.
// See e2e/README.md. Seeds its own event with a random slug, so it never touches other events.
//   E2E_BASE_URL=http://localhost:5199 E2E_DATABASE_URL=postgres://.../racecentral_e2e node --test e2e/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5199';
const DB_URL = process.env.E2E_DATABASE_URL;
if (!DB_URL || !/_e2e$/.test(new URL(DB_URL).pathname)) throw new Error('E2E_DATABASE_URL must point at a database whose name ends in _e2e');

const db = new pg.Client({ connectionString: DB_URL });
const slug = `e2e-${Date.now()}`;
const key = `rk_e2e_${Date.now()}`;
const T0 = Date.UTC(2026, 9, 22, 6, 0, 0); // race start
let ev;

const api = (path, { method = 'GET', body, auth = key } = {}) =>
	fetch(`${BASE}/api/events/${slug}${path}`, {
		method,
		headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
		body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
	});
const upload = async (reads) => {
	const r = await api('/reads', { method: 'POST', body: { reads } });
	return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
};
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = (o) => ({ device_id: 'ESP-A', station: 'Start', voided: false, bib: null, ...o });

before(async () => {
	await db.connect();
	[ev] = await rows('insert into events(name, slug, api_key_hash, api_key, published) values($1,$2,$3,$4,true) returning id', ['E2E Run', slug, createHash('sha256').update(key).digest('hex'), key]);
	await db.query("insert into stations(event_id,name,kind,ord) values($1,'Start','start',0),($1,'CP1','checkpoint',1),($1,'Finish','finish',2)", [ev.id]);
	const [cat] = await rows("insert into categories(event_id,name) values($1,'5K') returning id", [ev.id]);
	await db.query(
		`insert into participants(event_id,category_id,bib,name,tag,gender,age) values
		 ($1,$2,'101','Ana','T101','F',30),($1,$2,'102','Ben','T102','M',40),($1,$2,'103','Cara','','F',25),($1,$2,'104','Dan','T104','M',50)`,
		[ev.id, cat.id]
	);
});
after(async () => {
	if (process.env.E2E_KEEP !== '1') await db.query('delete from events where id=$1', [ev.id]);
	await db.end();
});

test('auth: missing key, wrong key and wrong event are all 401', async () => {
	assert.equal((await api('/participants', { auth: null })).status, 401);
	assert.equal((await api('/participants', { auth: 'rk_wrong' })).status, 401);
	const other = await fetch(`${BASE}/api/events/no-such-${slug}/participants`, { headers: { authorization: `Bearer ${key}` } });
	assert.equal(other.status, 401);
});

test('roster: participants come back with category and tag, sorted by bib', async () => {
	const r = await api('/participants');
	assert.equal(r.status, 200);
	assert.deepEqual(await r.json(), [
		{ bib: '101', name: 'Ana', category: '5K', tag: 'T101' },
		{ bib: '102', name: 'Ben', category: '5K', tag: 'T102' },
		{ bib: '103', name: 'Cara', category: '5K', tag: '' },
		{ bib: '104', name: 'Dan', category: '5K', tag: 'T104' }
	]);
});

test('upload: insert, resend is a duplicate, void and restore update in place', async () => {
	const batch = [read({ tag: 'T101', read_at_ms: T0 }), read({ tag: 'T101', station: 'Finish', read_at_ms: T0 + 1_500_000 })];
	assert.deepEqual((await upload(batch)).body, { received: 2, inserted: 2, updated: 0, duplicates: 0 });
	assert.deepEqual((await upload(batch)).body, { received: 2, inserted: 0, updated: 0, duplicates: 2 });

	const voided = [{ ...batch[1], voided: true }];
	assert.deepEqual((await upload(voided)).body, { received: 1, inserted: 0, updated: 1, duplicates: 0 });
	assert.equal((await rows('select voided from reads where event_id=$1 and read_at_ms=$2', [ev.id, T0 + 1_500_000]))[0].voided, true);
	assert.deepEqual((await upload([batch[1]])).body, { received: 1, inserted: 0, updated: 1, duplicates: 0 });
	assert.equal((await rows('select count(*)::int n from reads where event_id=$1', [ev.id]))[0].n, 2);
});

test('attribution: tag matches case-insensitively, a bib-as-tag manual read matches, an explicit bib wins', async () => {
	await upload([
		read({ tag: 't102', read_at_ms: T0 + 1 }), // lower case tag
		read({ device_id: 'MANUAL', tag: '103', read_at_ms: T0 + 2 }), // runner without a tag, entered by bib
		read({ device_id: 'ESP-A', tag: 'UNKNOWNTAG', bib: '104', read_at_ms: T0 + 3 })
	]);
	const got = await rows('select tag, bib from reads where event_id=$1 and read_at_ms between $2 and $3 order by read_at_ms', [ev.id, T0 + 1, T0 + 3]);
	assert.deepEqual(got, [
		{ tag: 't102', bib: '102' },
		{ tag: '103', bib: '103' },
		{ tag: 'UNKNOWNTAG', bib: '104' }
	]);
});

test('unknown station name is stored, not counted, and remembered for "Add as station"', async () => {
	await upload([read({ tag: 'T102', station: 'Fnish', read_at_ms: T0 + 99 })]);
	const [r] = await rows('select station_id, station_name_sent from reads where event_id=$1 and read_at_ms=$2', [ev.id, T0 + 99]);
	assert.deepEqual(r, { station_id: null, station_name_sent: 'Fnish' });
});

test('station name matches case-insensitively', async () => {
	await upload([read({ tag: 'T104', station: 'cp1', read_at_ms: T0 + 600_000 })]);
	const [r] = await rows('select s.name from reads r join stations s on s.id=r.station_id where r.event_id=$1 and r.read_at_ms=$2', [ev.id, T0 + 600_000]);
	assert.equal(r.name, 'CP1');
});

test('validation: bad bodies are 400 and nothing from a bad batch is stored', async () => {
	assert.equal((await api('/reads', { method: 'POST', body: 'not json' })).status, 400);
	assert.equal((await api('/reads', { method: 'POST', body: { reads: 'x' } })).status, 400);
	assert.equal((await upload([read({ read_at_ms: T0 })])).status, 400); // no tag
	assert.equal((await upload([read({ tag: 'T101', read_at_ms: 'soon' })])).status, 400);
	assert.equal((await upload(Array.from({ length: 2001 }, (_, i) => read({ tag: 'X', read_at_ms: i })))).status, 400);
	const before = (await rows('select count(*)::int n from reads where event_id=$1', [ev.id]))[0].n;
	assert.equal((await upload([read({ tag: 'GOOD', read_at_ms: T0 + 5 }), read({ tag: '', read_at_ms: T0 + 6 })])).status, 400);
	assert.equal((await rows('select count(*)::int n from reads where event_id=$1', [ev.id]))[0].n, before);
});

test('heartbeat: stored with clock skew, malformed is 400', async () => {
	const beat = { laptop_id: 'L-E2E', laptop_name: 'Finish laptop', app_version: '0.1.0', now_ms: Date.now() - 5000, pending: 3, last_error: '', stations: [{ name: 'Finish', kind: 'finish', readers_total: 1, readers_online: 1, last_read_ms: null, pending: 3 }] };
	const r = await api('/heartbeat', { method: 'POST', body: beat });
	assert.equal(r.status, 200);
	assert.equal((await r.json()).ok, true);
	const [hb] = await rows('select laptop_name, clock_skew_ms, payload from station_heartbeats where event_id=$1', [ev.id]);
	assert.equal(hb.laptop_name, 'Finish laptop');
	assert.ok(Number(hb.clock_skew_ms) >= 4000, `skew ${hb.clock_skew_ms}`);
	assert.equal(hb.payload.pending, 3);
	assert.equal((await api('/heartbeat', { method: 'POST', body: { laptop_id: 'x' } })).status, 400);
	assert.equal((await api('/heartbeat', { method: 'POST', body: beat, auth: 'rk_wrong' })).status, 401);
});

test('results: uploaded start/finish reads produce a ranked time on the public board', async () => {
	await upload([read({ tag: 'T104', read_at_ms: T0 + 10 }), read({ tag: 'T104', station: 'Finish', read_at_ms: T0 + 1_200_000 })]);
	const r = await fetch(`${BASE}/e/${slug}/results`);
	assert.equal(r.status, 200);
	const cat = (await r.json()).categories.find((c) => c.name === '5K');
	// gun time = earliest start read in the category (T0); 104 finishes first, 101 second
	assert.deepEqual(cat.rows.map((x) => [x.rank, x.bib, x.time]), [[1, '104', 1_200_000], [2, '101', 1_500_000]]);
	assert.deepEqual(cat.rows[0].splits, [{ station: 'CP1', elapsed: 600_000 }]);
});

// ---------------------------------------------------------------- fixed bugs (see e2e/BUGS.md)

test('BUG-1 fixed: a read element that is not an object is 400', async () => {
	assert.equal((await api('/reads', { method: 'POST', body: [null] })).status, 400);
	assert.equal((await api('/reads', { method: 'POST', body: [7] })).status, 400);
});

test('BUG-2 fixed: a fractional read_at_ms is 400', async () => {
	assert.equal((await upload([read({ tag: 'T101', read_at_ms: T0 + 0.5 })])).status, 400);
});

test('BUG-3 fixed: two different reads with the same device, time and tag are both kept', async () => {
	// what the fixed station sends for a manual Start and a manual Finish typed with the same time on one laptop
	const at = T0 + 7_777;
	const r = await upload([read({ device_id: 'MANUAL', tag: 'T102', station: 'Start', read_at_ms: at, src: 'manual-L1:1' }), read({ device_id: 'MANUAL', tag: 'T102', station: 'Finish', read_at_ms: at, src: 'manual-L1:2' })]);
	assert.equal(r.body.inserted, 2, JSON.stringify(r.body));
	assert.equal((await upload([read({ device_id: 'MANUAL', tag: 'T102', station: 'Finish', read_at_ms: at, src: 'manual-L1:2' })])).body.duplicates, 1);
});

test('BUG-4 fixed: voiding one of two same-time reads leaves the other alone', async () => {
	const at = T0 + 8_888;
	await upload([read({ tag: 'T101', station: 'CP1', read_at_ms: at, src: 'b1:1' })]);
	await upload([read({ tag: 'T101', station: 'Finish', read_at_ms: at, src: 'b1:2', voided: true })]);
	const got = await rows('select s.name, r.voided from reads r join stations s on s.id=r.station_id where r.event_id=$1 and r.read_at_ms=$2 order by s.ord', [ev.id, at]);
	assert.deepEqual(got, [{ name: 'CP1', voided: false }, { name: 'Finish', voided: true }]);
});

test('BUG-5 fixed: a stale bib from the station loses to the tag the central app gave another runner', async () => {
	await db.query("update participants set tag='' where event_id=$1 and bib='102'", [ev.id]);
	await db.query("update participants set tag='T102' where event_id=$1 and bib='104'", [ev.id]); // tag moved 102 -> 104
	await upload([read({ tag: 'T102', bib: '102', station: 'CP1', read_at_ms: T0 + 9_999, src: 'b1:9' })]);
	assert.equal((await rows('select bib from reads where event_id=$1 and read_at_ms=$2', [ev.id, T0 + 9_999]))[0].bib, '104');
	await db.query("update participants set tag=case bib when '102' then 'T102' else 'T104' end where event_id=$1 and bib in ('102','104')", [ev.id]);
});

test('a void made in the admin is not undone when the station uploads that read again', async () => {
	const at = T0 + 11_111;
	await upload([read({ tag: 'T104', station: 'CP1', read_at_ms: at, src: 'b1:11' })]);
	await db.query('update reads set voided=true, voided_by_admin=true where event_id=$1 and read_at_ms=$2', [ev.id, at]); // what the admin Void button does
	assert.equal((await upload([read({ tag: 'T104', station: 'CP1', read_at_ms: at, src: 'b1:11', voided: false })])).body.updated, 0);
	assert.equal((await rows('select voided from reads where event_id=$1 and read_at_ms=$2', [ev.id, at]))[0].voided, true);
});

test('upgrade: a read stored by an older station app (no identity) is matched, not duplicated, when sent again with one', async () => {
	const at = T0 + 12_121;
	await upload([read({ tag: 'T101', station: 'CP1', read_at_ms: at })]); // older app: no src
	const r = await upload([read({ tag: 'T101', station: 'CP1', read_at_ms: at, src: 'b1:12', voided: true })]);
	assert.deepEqual(r.body, { received: 1, inserted: 0, updated: 1, duplicates: 0 });
	assert.deepEqual(await rows('select src, voided from reads where event_id=$1 and read_at_ms=$2', [ev.id, at]), [{ src: 'b1:12', voided: true }]);
});

test('file upload without identity (station CSV) still dedupes against the live upload', async () => {
	const at = T0 + 13_131;
	await upload([read({ tag: 'T104', station: 'Finish', read_at_ms: at, src: 'b1:13' })]);
	assert.equal((await upload([read({ tag: 'T104', station: 'Finish', read_at_ms: at })])).body.duplicates, 1);
	assert.equal((await rows('select count(*)::int n from reads where event_id=$1 and read_at_ms=$2', [ev.id, at]))[0].n, 1);
});
