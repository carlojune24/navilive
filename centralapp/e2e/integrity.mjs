// Mid-race data integrity: while a station keeps uploading reads, an admin changes courses, batches, categories, bibs,
// stations and the participant list through the real admin form actions. After every change the live results, the
// database and the board's update stream are compared with a model of where every runner should be.
//   E2E_DATABASE_URL=postgres://.../racecentral_e2e E2E_BASE_URL=http://localhost:5199 node e2e/integrity.mjs
// Uses the event "integrity" (re-created on every run) and the e2e admin password set by esp-race.mjs. Report: e2e/data/integrity-report.json
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5199';
const DB_URL = process.env.E2E_DATABASE_URL;
if (!DB_URL || !/_e2e$/.test(new URL(DB_URL).pathname)) throw new Error('E2E_DATABASE_URL must point at a database whose name ends in _e2e');
const SLUG = 'integrity';
const KEY = 'rk_integrity';
const ADMIN_PW = 'e2e-admin-check';
const MIN = 60_000;
const DATA = fileURLToPath(new URL('./data/', import.meta.url));
mkdirSync(DATA, { recursive: true });

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await rows(sql, p))[0];

// ---- seed: Start/CP1/Finish. 5K (course Start-CP1-Finish) in two waves; 10K (every station) with one gun. 101-115 5K, 201-210 10K.
await db.query('delete from events where slug=$1', [SLUG]);
const ev = await one('insert into events(name, slug, api_key_hash, api_key, published) values($1,$2,$3,$4,true) returning id', ['Integrity Run', SLUG, createHash('sha256').update(KEY).digest('hex'), KEY]);
const st = {};
for (const [i, [name, kind]] of [['Start', 'start'], ['CP1', 'checkpoint'], ['Finish', 'finish']].entries())
	st[name] = (await one('insert into stations(event_id,name,kind,ord) values($1,$2,$3,$4) returning id', [ev.id, name, kind, i])).id;
const T0 = Date.now() - 40 * MIN;
const cat = {
	'5K': (await one("insert into categories(event_id,name) values($1,'5K') returning id", [ev.id])).id,
	'10K': (await one("insert into categories(event_id,name,gun_ms) values($1,'10K',$2) returning id", [ev.id, T0 - 10 * MIN])).id
};
for (const [i, s] of ['Start', 'CP1', 'Finish'].entries()) await db.query('insert into category_courses(category_id,station_id,ord) values($1,$2,$3)', [cat['5K'], st[s], i]);
const batch = {
	'Wave A': (await one("insert into batches(category_id,name,gun_ms) values($1,'Wave A',$2) returning id", [cat['5K'], T0])).id,
	'Wave B': (await one("insert into batches(category_id,name,gun_ms) values($1,'Wave B',$2) returning id", [cat['5K'], T0 + 3 * MIN])).id
};
const gunOfBatch = { [batch['Wave A']]: T0, [batch['Wave B']]: T0 + 3 * MIN };
const gunOfCat = { [cat['5K']]: null, [cat['10K']]: T0 - 10 * MIN };

// the model: where every runner should be, and when they really crossed the finish
const model = new Map();
const add = (bib, c, b, tag) => model.set(bib, { bib, cat: c, batch: b, tag, finish: null });
for (let i = 0; i < 15; i++) add(String(101 + i), cat['5K'], i < 8 ? batch['Wave A'] : batch['Wave B'], `E2000${101 + i}`);
for (let i = 0; i < 10; i++) add(String(201 + i), cat['10K'], null, `E2000${201 + i}`);
for (const m of model.values())
	await db.query('insert into participants(event_id,category_id,batch_id,bib,name,tag) values($1,$2,$3,$4,$5,$6)', [ev.id, m.cat, m.batch, m.bib, `Runner ${m.bib}`, m.tag]);

// ---- the station: every runner passes Start, CP1 and Finish; 101-110 and 201-205 have finished by the end of the test
let seq = 0;
const plan = [];
for (const m of model.values()) {
	const gun = m.batch ? gunOfBatch[m.batch] : gunOfCat[m.cat];
	const k = Number(m.bib) % 100;
	const at = { Start: gun + 5_000 + k * 700, CP1: gun + 12 * MIN + k * 9_000, Finish: gun + 24 * MIN + k * 17_000 };
	for (const s of ['Start', 'CP1', 'Finish']) {
		if (s === 'Finish' && !(k <= 10 && (m.cat === cat['5K'] || k <= 5))) continue;
		plan.push({ tag: m.tag, bib: m.bib, station: s, read_at_ms: at[s], device_id: `ESP-${s.toUpperCase()}`, voided: false, src: `boot1:${++seq}` });
	}
}
plan.sort((a, b) => a.read_at_ms - b.read_at_ms);
const sent = [];
const post = (path, body) => fetch(`${BASE}/api/events/${SLUG}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
const upload = async (n) => {
	const chunk = plan.splice(0, n);
	if (!chunk.length) return;
	const r = await post('/reads', { reads: chunk });
	if (!r.ok) throw new Error(`upload failed ${r.status}`);
	sent.push(...chunk);
	for (const x of chunk) if (x.station === 'Finish') [...model.values()].find((m) => m.tag === x.tag).finish = x.read_at_ms; // by tag: bibs get renumbered
};

// ---- the admin, through the real form actions
const salt = randomBytes(16);
await db.query("insert into app_settings(key,value) values('admin_password_hash',$1) on conflict(key) do nothing", [
	['scrypt', 2 ** 15, 8, 1, salt.toString('base64'), scryptSync(ADMIN_PW, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 2 ** 26 }).toString('base64')].join('$')
]);
let cookie = null;
for (let i = 0; i < 40 && !cookie; i++) {
	const r = await fetch(`${BASE}/login`, { method: 'POST', redirect: 'manual', headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${ADMIN_PW}` });
	cookie = r.headers.get('set-cookie')?.split(';')[0] ?? null;
	if (!cookie) await new Promise((ok) => setTimeout(ok, 1000)); // the server caches the password hash for 30 s
}
if (!cookie) throw new Error('admin login failed');
let mark = 0; // board updates seen before the last admin action was sent
const act = async (name, fields) => {
	mark = updates;
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.append(k, v instanceof Blob ? v : String(v));
	const r = await fetch(`${BASE}/admin/${SLUG}?/${name}`, { method: 'POST', headers: { cookie, origin: BASE, 'x-sveltekit-action': 'true' }, body });
	const j = await r.json().catch(() => ({}));
	return { status: r.status, type: j.type, error: j.error?.message ?? (j.type === 'failure' ? JSON.parse(j.data ?? '[]').at(-1) : undefined) };
};
const pid = async (bib) => (await one('select id from participants where event_id=$1 and bib=$2', [ev.id, bib]))?.id;
const edit = async (bib, changes) => {
	const p = await one('select * from participants where event_id=$1 and bib=$2', [ev.id, bib]);
	return act('updateParticipant', { id: p.id, bib: p.bib, name: p.name, tag: p.tag, category: p.category_id ?? '', batch: p.batch_id ?? '', gender: p.gender ?? '', age: p.age ?? '', ...changes });
};

// ---- the board's update stream, as an LED wall would hold it open
let updates = 0;
const stream = await fetch(`${BASE}/e/${SLUG}/stream`);
(async () => {
	const rd = stream.body.getReader();
	const dec = new TextDecoder();
	for (;;) {
		const { value, done } = await rd.read();
		if (done) return;
		updates += (dec.decode(value).match(/data: update/g) ?? []).length;
	}
})();
const settle = () => new Promise((ok) => setTimeout(ok, 1200));

// ---- what must always be true
const report = [];
const known = new Set(); // a problem is listed at the step that caused it, then counted as still there
async function verify(step, { action, boardShouldUpdate = true, note } = {}) {
	const before = mark;
	await settle();
	const problems = [];
	if (action && action.type !== 'success') problems.push(`action answered ${action.status} ${action.type}${action.error ? `: ${action.error}` : ''}`);
	const res = await (await fetch(`${BASE}/e/${SLUG}/results`)).json();
	const live = [...model.values()].filter((m) => res.categories.some((c) => c.id === m.cat));
	// every runner of a visible category is on the board exactly once, in the category the model says
	const where = new Map();
	for (const c of res.categories) for (const p of c.progress) where.set(p.bib, [...(where.get(p.bib) ?? []), c.name]);
	const catName = Object.fromEntries(Object.entries(cat).map(([n, id]) => [id, n]));
	for (const m of live) {
		const seen = where.get(m.bib) ?? [];
		if (seen.length !== 1 || seen[0] !== catName[m.cat]) problems.push(`bib ${m.bib}: on the board in [${seen.join(', ')}], should be in ${catName[m.cat]}`);
	}
	for (const [bib, seen] of where) if (!model.has(bib)) problems.push(`bib ${bib}: on the board in ${seen} but not a runner`);
	// a batch always belongs to the runner's own category, and is the one the model says
	for (const p of await rows('select p.bib, p.category_id, p.batch_id, b.category_id as batch_cat from participants p left join batches b on b.id=p.batch_id where p.event_id=$1', [ev.id])) {
		const m = model.get(p.bib);
		if (!m) problems.push(`bib ${p.bib}: in the database but not a runner`);
		else if (p.category_id !== m.cat || p.batch_id !== m.batch) problems.push(`bib ${p.bib}: category ${catName[p.category_id]} batch ${p.batch_id}, should be ${catName[m.cat]} batch ${m.batch}`);
		if (p.batch_id && p.batch_cat !== p.category_id) problems.push(`bib ${p.bib}: in ${catName[p.category_id]} but its batch belongs to ${catName[p.batch_cat]}`);
	}
	// no read lost, none doubled, none without a station
	const [{ n, nostation }] = await rows('select count(*)::int n, count(*) filter (where station_id is null)::int nostation from reads where event_id=$1', [ev.id]);
	if (n !== sent.length) problems.push(`${n} reads stored, ${sent.length} uploaded`);
	if (nostation) problems.push(`${nostation} reads lost their station`);
	// every finisher's time is finish minus their own start group's gun
	const shown = new Map(res.categories.flatMap((c) => c.rows.map((r) => [r.bib, r.time])));
	// a group with no gun set starts at its earliest start read
	const startOf = (tag) => Math.min(...sent.filter((r) => r.tag === tag && r.station === 'Start').map((r) => r.read_at_ms));
	const gunOf = (m) => (m.batch ? gunOfBatch[m.batch] : gunOfCat[m.cat] ?? Math.min(...live.filter((o) => o.cat === m.cat && !o.batch).map((o) => startOf(o.tag))));
	for (const m of live) {
		if (m.finish === null) continue;
		const want = m.finish - gunOf(m);
		if ((shown.get(m.bib) ?? null) !== want) problems.push(`bib ${m.bib}: time ${shown.get(m.bib) ?? 'none'}, should be ${want}`);
	}
	if (boardShouldUpdate && updates === before) problems.push('open boards were not told to refresh');
	const fresh = problems.filter((p) => !known.has(p));
	for (const p of problems) if (p !== 'open boards were not told to refresh') known.add(p);
	const still = problems.length - fresh.length;
	report.push({ step, ok: !problems.length, problems: fresh, still, note });
	console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${step}${fresh.map((p) => `\n        ${p}`).join('')}${still ? `\n        (and ${still} problem(s) from earlier steps, still there)` : ''}`);
}

// ---- the race
await upload(30);
await verify('race under way: baseline', { boardShouldUpdate: false });

// courses
await verify('5K course changed to Start-Finish mid-race', { action: await act('saveCourses', { courses: JSON.stringify({ [cat['5K']]: [st.Start, st.Finish] }) }) });
await upload(8);
await verify('5K course back to Start-CP1-Finish', { action: await act('saveCourses', { courses: JSON.stringify({ [cat['5K']]: [st.Start, st.CP1, st.Finish] }) }) });

// batches
let a = await act('removeFromBatch', { id: await pid('105') });
model.get('105').batch = null;
await verify('105 taken out of Wave A (timed from the 5K category gun: none set)', { action: a });
a = await act('assignBatch', { category: cat['5K'], batch: batch['Wave B'], bibs: '105' });
model.get('105').batch = batch['Wave B'];
await verify('105 put into Wave B', { action: a });
a = await act('assignBatch', { category: cat['5K'], batch: batch['Wave A'], bibs: '106, 999' });
await verify('assigning a batch with a typo bib changes nobody', { action: a.type === 'failure' ? { ...a, type: 'success' } : a, boardShouldUpdate: false, note: `answered: ${a.error}` });
await upload(8);

// participants
a = await edit('103', { bib: '153' });
model.set('153', { ...model.get('103'), bib: '153' });
model.delete('103');
await verify('103 renumbered to 153: reads follow', { action: a });
await upload(5);
const late = { tag: 'E2000103', bib: '103', station: 'Finish', read_at_ms: T0 + 40 * MIN, device_id: 'ESP-FINISH', voided: false, src: 'boot1:9001' }; // station roster still says 103
await post('/reads', { reads: [late] });
sent.push(late);
const stale = (await rows("select count(*)::int n from reads where event_id=$1 and bib='103'", [ev.id]))[0].n;
await verify('a station with the old roster uploads tag E2000103 as bib 103: still credited to 153', { boardShouldUpdate: false, note: `${stale} read(s) stored under the old bib 103` });
if (stale) report.at(-1).problems.push(`${stale} read(s) stored under the old bib 103`), (report.at(-1).ok = false);
a = await edit('110', { category: cat['10K'] });
Object.assign(model.get('110'), { cat: cat['10K'], batch: null });
await verify('110 moved 5K -> 10K in the edit form', { action: a });
a = await act('importBibs', { category: cat['10K'], bibs: '107' });
Object.assign(model.get('107'), { cat: cat['10K'], batch: null });
await verify('107 (Wave A) moved 5K -> 10K by "Import bibs"', { action: a });
const csv = new Blob([`bib,name,tag,category\n108,Runner 108,E2000109,\n109,Runner 109,E2000108,\n`], { type: 'text/csv' });
a = await act('importCsv', { category: 'keep', file: new File([csv], 'fix.csv') });
if (a.type === 'success') [model.get('108').tag, model.get('109').tag] = [model.get('109').tag, model.get('108').tag];
await verify('CSV re-import that swaps the tags of 108 and 109', { action: a, boardShouldUpdate: false });
a = await act('deleteParticipant', { id: await pid('208') });
const gone = model.get('208');
model.delete('208');
await verify('208 deleted by mistake', { action: a });
a = await act('addParticipant', { bib: '208', name: 'Runner 208', tag: gone.tag, category: cat['10K'], gender: '', age: '' });
model.set('208', gone);
await verify('208 added back: reads come back', { action: a });

// categories
a = await act('archiveCategory', { id: cat['10K'] });
await verify('10K archived by mistake (its runners leave the board)', { action: a });
a = await act('restoreCategory', { id: cat['10K'] });
await verify('10K restored', { action: a });
await act('deleteBatch', { id: batch['Wave B'] });
for (const m of model.values()) if (m.batch === batch['Wave B']) m.batch = null;
await verify('Wave B deleted: its runners fall back to the 5K category', { action: { type: 'success' } });

// stations
a = await act('deleteStation', { id: st.CP1 });
await verify('deleting CP1, which has reads, is refused', { action: a.type === 'failure' ? { type: 'success' } : { ...a, type: 'failure', error: 'the delete went through' }, boardShouldUpdate: false, note: `answered: ${a.error}` });
const course5k = (await rows('select s.name from category_courses cc join stations s on s.id=cc.station_id where cc.category_id=$1 order by cc.ord', [cat['5K']])).map((r) => r.name);
report.push({ step: 'the 5K course still has CP1', ok: course5k.join() === 'Start,CP1,Finish', problems: course5k.join() === 'Start,CP1,Finish' ? [] : [`5K course is now ${course5k.join(' -> ')}`] });
console.log(`${report.at(-1).ok ? 'PASS' : 'FAIL'}  ${report.at(-1).step}${report.at(-1).problems.map((p) => `\n        ${p}`).join('')}`);
const spare = (await one("insert into stations(event_id,name,kind,ord) values($1,'Spare','checkpoint',9) returning id", [ev.id])).id;
await settle();
a = await act('deleteStation', { id: spare });
await verify('a station with no reads can still be deleted', { action: a });

// everything at once: uploads racing admin changes
const rest = plan.length;
const results = await Promise.all([upload(Math.ceil(rest / 2)), act('saveCourses', { courses: JSON.stringify({ [cat['5K']]: [st.Start, st.CP1, st.Finish] }) }), act('setRankBy', { id: cat['5K'], rank_by: 'elapsed' }), upload(rest)]);
await verify(`${rest} reads uploaded while the admin saves courses and ranking`, { action: results.find((r) => r && r.type !== 'success') ?? { type: 'success' } });

writeFileSync(DATA + 'integrity-report.json', JSON.stringify(report, null, 2));
console.log(`\n${report.filter((r) => r.ok).length}/${report.length} steps pass. Board: ${BASE}/e/${SLUG}   admin: ${BASE}/admin/${SLUG}`);
await db.end();
process.exit(report.every((r) => r.ok) ? 0 : 1);
