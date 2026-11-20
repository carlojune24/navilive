// The Reports page end to end: reads of every source go in through the station API and the admin forms, then the page,
// the audit log, the CSV exports and the station-vs-central count check are read back as the admin would see them.
//   E2E_BASE_URL=http://localhost:5199 E2E_DATABASE_URL=postgres://.../racecentral_e2e node --test e2e/reports.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5199';
const DB_URL = process.env.E2E_DATABASE_URL;
if (!DB_URL || !/_e2e$/.test(new URL(DB_URL).pathname)) throw new Error('E2E_DATABASE_URL must point at a database whose name ends in _e2e');
const db = new pg.Client({ connectionString: DB_URL });
const slug = `rep-${Date.now()}`;
const key = `rk_rep_${Date.now()}`;
const PW = 'e2e-admin-check';
const T0 = Date.UTC(2026, 9, 22, 6, 0, 0);
let ev, cookie;

const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
const station = (path, body) => fetch(`${BASE}/api/events/${slug}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
const admin = (path, o = {}) => fetch(`${BASE}/admin/${slug}${path}`, { ...o, headers: { cookie, origin: BASE, ...(o.headers ?? {}) } });
const action = (name, fields) => admin(`?/${name}`, { method: 'POST', headers: { 'x-sveltekit-action': 'true' }, body: new URLSearchParams(fields) });

before(async () => {
	await db.connect();
	const salt = randomBytes(16);
	await db.query("insert into app_settings(key,value) values('admin_password_hash',$1) on conflict(key) do nothing", [
		['scrypt', 2 ** 15, 8, 1, salt.toString('base64'), scryptSync(PW, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 2 ** 26 }).toString('base64')].join('$')
	]);
	[ev] = await rows('insert into events(name, slug, api_key_hash, api_key, published) values($1,$2,$3,$4,true) returning id', ['Reports Run', slug, createHash('sha256').update(key).digest('hex'), key]);
	await db.query("insert into stations(event_id,name,kind,ord) values($1,'Start','start',0),($1,'CP1','checkpoint',1),($1,'Finish','finish',2)", [ev.id]);
	const [cat] = await rows("insert into categories(event_id,name) values($1,'5K') returning id", [ev.id]);
	await db.query("insert into participants(event_id,category_id,bib,name,tag,gender,age) values($1,$2,'101','Ana','T101','F',30),($1,$2,'102','Ben','T102','M',40)", [ev.id, cat.id]);
	for (let i = 0; i < 40 && !cookie; i++) {
		const r = await fetch(`${BASE}/login`, { method: 'POST', redirect: 'manual', headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${PW}` });
		cookie = r.headers.get('set-cookie')?.split(';')[0] ?? null;
		if (!cookie) await new Promise((ok) => setTimeout(ok, 1000)); // the server caches the password hash for 30 s
	}
	assert.ok(cookie, 'admin login failed');
});
after(async () => {
	if (process.env.E2E_KEEP !== '1') await db.query('delete from events where id=$1', [ev.id]);
	await db.end();
});

test('every way of getting a read in is stored with its own source', async () => {
	// Ana: reader at Start, hand tap on the station laptop at CP1 (the reader missed her), reader at Finish
	assert.equal((await station('/reads', { reads: [
		{ tag: 'T101', station: 'Start', read_at_ms: T0, device_id: 'ESP-A', src: 'b:1' },
		{ tag: 'T101', station: 'CP1', read_at_ms: T0 + 600_000, device_id: 'MANUAL', src: 'manual-L1:1' },
		{ tag: 'T101', station: 'Finish', read_at_ms: T0 + 1_500_000, device_id: 'ESP-B', src: 'b:2' },
		{ tag: 'T102', station: 'Start', read_at_ms: T0, device_id: 'ESP-A', src: 'b:3' }
	] })).status, 200);
	// Ben at CP1: a marshal's phone, and Ben at Finish: typed in by the admin
	assert.equal((await station('/reads', { reads: [{ tag: 'T102', station: 'CP1', read_at_ms: Date.now(), device_id: 'Marshal Joy', server_time: true }] })).status, 200);
	const cp1 = (await rows("select id from stations where event_id=$1 and name='Finish'", [ev.id]))[0].id;
	await action('manualRead', { bib: '102', station: String(cp1), ms: String(T0 + 1_700_000), reason: 'tag fell off' });
	const got = await rows('select bib, source from reads where event_id=$1 order by bib, read_at_ms', [ev.id]);
	assert.deepEqual(got.map((r) => `${r.bib}:${r.source}`).sort(), ['101:rfid', '101:rfid', '101:station_manual', '102:admin_manual', '102:marshal', '102:rfid']);
});

test('the admin log records who-did-what: add and void both leave a row with the reason', async () => {
	const [read] = await rows("select id from reads where event_id=$1 and source='rfid' and bib='102'", [ev.id]);
	await action('voidRead', { id: String(read.id), voided: 'true', reason: 'wrong runner' });
	await action('voidRead', { id: String(read.id), voided: 'false', reason: '' });
	const log = await rows('select action, reason from read_audit where event_id=$1 order by id', [ev.id]);
	assert.deepEqual(log, [{ action: 'admin_add', reason: 'tag fell off' }, { action: 'void', reason: 'wrong runner' }, { action: 'restore', reason: '' }]);
});

test('the Reports page shows the runner list and, for Ana, the reader miss and the source of each read', async () => {
	const list = await (await admin('/reports')).text();
	assert.match(list, /Reports - Reports Run/);
	assert.match(list, /Ana/);
	const ana = await (await admin('/reports?bib=101')).text();
	assert.match(ana, /Reader missed \(hand only\)/);
	assert.match(ana, /Station tap/);
	const ben = await (await admin('/reports?bib=102')).text();
	assert.match(ben, /Marshal tap/);
	assert.match(ben, /Admin entry/);
	assert.match(ben, /wrong runner/); // the audit line shows on the voided/restored read
});

test('CSV: reads carry a source column and the trail export has one row per runner per station', async () => {
	const reads = await (await admin('/export?kind=reads')).text();
	assert.match(reads, /device,source,voided/);
	assert.match(reads, /Station tap/);
	const trail = (await (await admin('/export?kind=trail')).text()).trim().split(/\r?\n/);
	assert.equal(trail.length, 1 + 2 * 3); // header + 2 runners x 3 stations
	assert.match(trail.find((l) => l.includes('101') && l.includes('CP1')), /,0,1,0,.*Station tap,.*miss/);
});

test('reconciliation: a laptop that reports more RFID reads than central holds shows a shortfall', async () => {
	await station('/heartbeat', { laptop_id: 'L1', laptop_name: 'Start laptop', app_version: 't', now_ms: Date.now(), pending: 0, last_error: '', stations: [
		{ name: 'Start', kind: 'start', readers_total: 1, readers_online: 1, last_read_ms: T0, pending: 0, rfid_count: 5, manual_count: 0 }
	] });
	const page = await (await admin('/reports')).text();
	assert.match(page, /Central is short: 3 RFID, 0 tap/); // Start: central has 2 RFID reads, the laptop says 5
});

test('station keys: a read is traced to the laptop key, requiring keys locks out the shared key for reader uploads, revoking cuts one laptop off', async () => {
	// make a key through the admin form; the result carries it once (SvelteKit serializes it, so pull it out of the response text)
	const made = await (await action('createStationKey', { label: 'Finish laptop' })).text();
	const laptopKey = made.match(/rk_[0-9a-f]{48}/)?.[0];
	assert.ok(laptopKey, 'the key is shown once in the action result');
	assert.equal((await rows('select count(*)::int n from station_keys where event_id=$1 and key_hash=$2', [ev.id, createHash('sha256').update(laptopKey).digest('hex')]))[0].n, 1);
	assert.equal((await rows('select count(*)::int n from station_keys where key_hash=$1', [laptopKey]))[0].n, 0, 'only the hash is stored');

	const as = (k, body, path = '/reads') => fetch(`${BASE}/api/events/${slug}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` }, body: JSON.stringify(body) });
	const rd = (n, extra = {}) => ({ tag: 'T101', station: 'Finish', read_at_ms: T0 + 9_000_000 + n, device_id: 'ESP-K', src: `k:${n}`, ...extra });

	assert.equal((await as(laptopKey, { reads: [rd(1)] })).status, 200);
	const [row] = await rows("select k.label from reads r join station_keys k on k.id=r.key_id where r.event_id=$1 and r.src='k:1'", [ev.id]);
	assert.equal(row.label, 'Finish laptop');
	assert.equal((await rows("select key_id from reads where event_id=$1 and src='b:1'", [ev.id]))[0].key_id, null, 'a read sent with the shared key has no key id');

	await action('setRequireStationKeys', { on: 'true' });
	assert.equal((await as(key, { reads: [rd(2)] })).status, 403, 'shared key refused for a reader upload');
	assert.equal((await as(key, { reads: [{ tag: 'T102', station: 'CP1', read_at_ms: Date.now(), device_id: 'Marshal Joy', server_time: true }] })).status, 200, 'marshal taps still use the event key');
	assert.equal((await as(laptopKey, { reads: [rd(3)] })).status, 200);
	assert.equal((await as(laptopKey, {}, '/heartbeat')).status, 400, 'a station key is accepted by the other station endpoints (bad body, not 401)');

	const [{ id }] = await rows('select id from station_keys where event_id=$1', [ev.id]);
	await action('revokeStationKey', { id: String(id) });
	assert.equal((await as(laptopKey, { reads: [rd(4)] })).status, 401, 'a revoked key stops at once');
	await action('setRequireStationKeys', { on: 'false' });
	assert.equal((await as(key, { reads: [rd(5)] })).status, 200, 'the shared key works again once requirement is off');
});

test('station keys: requiring keys is refused while there is no active key', async () => {
	await db.query('update station_keys set revoked_at=now() where event_id=$1', [ev.id]);
	await action('setRequireStationKeys', { on: 'true' });
	assert.equal((await rows('select require_station_keys r from events where id=$1', [ev.id]))[0].r, false);
});

test('progress: the admin sees how each first read got in; the public board does not', async () => {
	// the earlier tests left Ana (101): reader at Start, station tap at CP1, reader at Finish; Ben (102): reader, marshal tap, admin entry
	const prog = await (await admin('?tab=progress')).text();
	for (const label of ['RFID', 'Station tap', 'Marshal tap', 'Admin entry']) assert.match(prog, new RegExp(label), `admin progress shows ${label}`);
	assert.match(prog, /not from the reader/);
	const pub = await (await fetch(`${BASE}/e/${slug}`)).text();
	for (const label of ['Station tap', 'Marshal tap', 'Admin entry']) assert.doesNotMatch(pub, new RegExp('>' + label + '<'), `public board hides ${label}`);
});

test('a read stored before its tag was assigned still lands on that runner (same matching as Progress)', async () => {
	const [cat] = await rows('select id from categories where event_id=$1', [ev.id]);
	await db.query("insert into participants(event_id,category_id,bib,name,tag,gender,age) values($1,$2,'103','Cara','','F',25)", [ev.id, cat.id]);
	await station('/reads', { reads: [{ tag: 'T103', station: 'Start', read_at_ms: T0 + 5, device_id: 'ESP-A', src: 'late:1' }] });
	assert.equal((await rows("select bib from reads where event_id=$1 and src='late:1'", [ev.id]))[0].bib, null, 'stored with no bib: nobody owned the tag yet');
	await db.query("update participants set tag='T103' where event_id=$1 and bib='103'", [ev.id]);
	const trail = (await (await admin('/export?kind=trail')).text()).split(/\r?\n/);
	assert.match(trail.find((l) => l.startsWith('103,') && l.includes('Start')), /,1,0,0,/);
});

test('public data (live board, big screen, wall) carries no read type or tagger; the Reads page has no Override link', async () => {
	// the page-level JSON the TV browser loads
	const pub = await (await fetch(`${BASE}/e/${slug}/results`)).json();
	const progress = pub.categories.flatMap((c) => c.progress);
	assert.ok(progress.length >= 2, 'there are runners to check');
	for (const r of progress) {
		assert.ok(r.src.every((x) => x === null), `bib ${r.bib}: no read type in public data`);
		assert.ok(r.by.every((x) => x === null), `bib ${r.bib}: no tagger in public data`);
	}
	// the finish wall pages are server-rendered from the same data: neither the page nor its serialized data may contain a type
	for (const path of ['', '/wall', '/wall/display']) {
		const html = await (await fetch(`${BASE}/e/${slug}${path}`)).text();
		for (const word of ['station_manual', 'admin_manual', 'Station tap', 'Admin entry', 'Marshal tap']) assert.ok(!html.includes(word), `/e/${slug}${path} must not contain ${word}`);
	}
	// the admin still sees them
	assert.ok((await (await admin('?tab=progress')).text()).includes('Station tap'));
	// Reads tab: the Override link is gone from the rows (it stays on Progress/Results)
	const reads = await (await admin('?tab=reads')).text();
	assert.ok(!/class="mr-2 underline"[^>]*>\s*Override/.test(reads), 'no Override link in the Reads table');
	assert.match(reads, /Reason/); // Void with a reason is still there
});
