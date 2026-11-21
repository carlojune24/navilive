import { group, check, note, login, act, api, sql, results, db, T0, min, results$ } from './lib.mjs';
import { readFileSync } from 'node:fs';
const { ev, cat, st } = JSON.parse(readFileSync(new URL('./state.json', import.meta.url)));
await login('qa-admin-pass-123');
const P = `/admin/${ev.slug}`;
const KEY = ev.api_key;
const up = (reads, key = KEY, slug = ev.slug) => api('POST', `/api/events/${slug}/reads`, { key, body: { reads } });
const tagOf = async (bib) => (await sql('select tag from participants where event_id=$1 and bib=$2', [ev.id, bib]))[0]?.tag;
const rd = (tag, station, at, device = 'LAPTOP-A', extra = {}) => ({ tag, station, read_at_ms: at, device_id: device, src: `${device}:${station}:${tag}:${at}`, ...extra });
const resAdmin = async (mode = 'gun') => {
	// the organizer's full view: release everything for the check, restored by the release tests later
	return results$(ev.slug, mode);
};

// ---------- STATION API AUTH + VALIDATION ----------
group('Station upload API: auth and validation');
{
	check('no key -> 401', (await up([rd('X', 'Start', T0)], '')).status === 401);
	check('wrong key -> 401', (await up([rd('X', 'Start', T0)], 'not-the-key')).status === 401);
	check('right key, wrong event slug -> 401', (await up([rd('X', 'Start', T0)], KEY, 'other-event')).status === 401);
	check('board API without key -> 401', (await api('GET', `/api/events/${ev.slug}/board`)).status === 401);
	check('participants API without key -> 401', (await api('GET', `/api/events/${ev.slug}/participants`)).status === 401);
	const ps = await api('GET', `/api/events/${ev.slug}/participants`, { key: KEY });
	check('participants API with key lists runners + team tag', ps.status === 200 && ps.json.length >= 75 && ps.json.find((p) => p.bib === 'D301')?.tag, `n=${ps.json?.length}`);
	for (const [label, body] of [
		['not an array', { reads: 'nope' }],
		['missing tag', { reads: [{ read_at_ms: T0 }] }],
		['empty tag', { reads: [{ tag: '', read_at_ms: T0 }] }],
		['fractional ms', { reads: [{ tag: 'A', read_at_ms: 1.5 }] }],
		['ms as string', { reads: [{ tag: 'A', read_at_ms: String(T0) }] }],
		['null element', { reads: [null] }],
		['2001 reads', { reads: Array.from({ length: 2001 }, (_, i) => ({ tag: 'A', read_at_ms: T0 + i })) }]
	]) {
		const r = await api('POST', `/api/events/${ev.slug}/reads`, { key: KEY, body });
		check(`bad upload refused (${label}) -> 400`, r.status === 400, `${r.status} ${r.text.slice(0, 80)}`);
	}
	const junk = await api('POST', `/api/events/${ev.slug}/reads`, { key: KEY, body: '{not json' });
	check('malformed JSON -> 400 (not 500)', junk.status === 400, `${junk.status}`);
	const n = (await sql('select count(*)::int n from reads where event_id=$1', [ev.id]))[0].n;
	check('nothing stored by refused uploads', n === 0, `n=${n}`);
}

// ---------- STARTS ----------
group('Starts: category gun, batches (waves)');
{
	const s1 = await act(P, 'startGun', { id: cat['21K'], kind: 'category', ms: T0 });
	check('21K gun set by typed time', s1.type === 'success' && Number((await sql('select gun_ms from categories where id=$1', [cat['21K']]))[0].gun_ms) === T0, JSON.stringify(s1));
	const again = await act(P, 'startGun', { id: cat['21K'], kind: 'category' });
	check('pressing Start again on a started category refused (409)', again.type === 'failure' && again.status === 409, JSON.stringify(again));
	await act(P, 'startGun', { id: cat.DUO, kind: 'category', ms: T0 + min(5) });
	// 10K in two waves
	const ids = (await sql('select id, bib from participants where category_id=$1 order by bib', [cat['10K']]));
	const w1 = await act(P, 'createBatch', { category: cat['10K'], ids: ids.slice(0, 15).map((p) => String(p.id)) });
	const w2 = await act(P, 'createBatch', { category: cat['10K'], ids: ids.slice(15).map((p) => String(p.id)) });
	check('10K split into Batch 1 and Batch 2', w1.data?.batchCreated?.name === '1' && w2.data?.batchCreated?.name === '2', JSON.stringify([w1.data, w2.data]));
	const dupe = await act(P, 'createBatch', { category: cat['10K'], ids: [String(ids[0].id)] });
	check('runner already in a batch cannot be put in another (all-or-nothing)', dupe.type === 'failure', JSON.stringify(dupe.data));
	const cross = await act(P, 'createBatch', { category: cat['21K'], ids: [String(ids[0].id)] });
	check('runner from another category refused in a batch', cross.type === 'failure');
	const b = Object.fromEntries((await sql('select id, name from batches where category_id=$1', [cat['10K']])).map((x) => [x.name, x.id]));
	await act(P, 'startGun', { id: b['1'], kind: 'batch', ms: T0 + min(10) });
	await act(P, 'startGun', { id: b['2'], kind: 'batch', ms: T0 + min(20) });
	const b2 = await act(P, 'startGun', { id: b['2'], kind: 'batch' });
	check('pressing Start again on a started batch refused (409)', b2.type === 'failure' && b2.status === 409);
	// parallel createBatch race: 5 clicks at once for the same free runner must create exactly one batch
	await act(P, 'addParticipant', { bib: '299', name: 'Late Ten', category: String(cat['10K']) });
	const [late] = await sql("select id from participants where event_id=$1 and bib='299'", [ev.id]);
	const races = await Promise.all(Array.from({ length: 5 }, () => act(P, 'createBatch', { category: cat['10K'], ids: [String(late.id)] })));
	check('5 simultaneous "create batch" clicks -> exactly 1 batch', races.filter((r) => r.type === 'success').length === 1, races.map((r) => r.type).join());
	await act(P, 'removeFromBatch', { id: late.id });
}

// ---------- RACE READS ----------
group('Race reads via station upload');
const plan = []; // expected finish per bib
const reads = [];
const cp1 = 'CP1 Ridge', cp2 = 'CP2 River';
// 21K: bibs 101-140 (+141 walk-up). 101..135 finish, 136-138 DNF after CP1, 139-140 DNS
for (let i = 1; i <= 41; i++) {
	const bib = String(100 + i);
	const tag = await tagOf(bib);
	if (!tag) continue;
	if (i >= 39 && i <= 40) continue;
	const pace = min(90) + i * 37_000;
	reads.push(rd(tag, 'Start', T0 + 2000 + i * 1000, 'START-PC'));
	reads.push(rd(tag, cp1, T0 + Math.round(pace * 0.4), 'CP1-PC'));
	if (i >= 36 && i <= 38) continue;
	reads.push(rd(tag, cp2, T0 + Math.round(pace * 0.75), 'CP2-PC'));
	reads.push(rd(tag, 'Finish', T0 + pace, 'FINISH-PC'));
	plan.push({ bib, time: pace });
}
{
	const r = await up(reads.filter((x) => x.station !== 'Finish'));
	const f = await up(reads.filter((x) => x.station === 'Finish'));
	check('21K reads accepted', r.status === 200 && f.status === 200 && r.json.inserted + f.json.inserted === reads.length, JSON.stringify([r.json, f.json]));
	const again = await up(reads);
	check('re-sending the same reads stores nothing new (idempotent)', again.status === 200 && again.json.inserted === 0 && again.json.duplicates === reads.length, JSON.stringify(again.json));
	const res = await resAdmin();
	const c21 = res.categories.find((c) => c.name === '21K');
	note(`public 21K rows: ${c21.rows.length}, held=${c21.held}, provisional=${c21.provisional}`);
	check('before release: the public board shows no finish times', c21.rows.length === 0 && c21.held === plan.length, `rows=${c21.rows.length} held=${c21.held}`);
	const pr = c21.progress.find((p) => p.bib === '101');
	check('before release: progress hides the finish column', pr && pr.time === null && pr.rank === null, JSON.stringify(pr).slice(0, 200));
}
await act(P, 'setRelease', { scope: 'all', level: 'released' });
{
	const res = await resAdmin();
	const c21 = res.categories.find((c) => c.name === '21K');
	const want = [...plan].sort((a, b) => a.time - b.time);
	check('after release: 35 finishers ranked', c21.rows.length === 35, `rows=${c21.rows.length}`);
	check('gun time = finish - gun (not own start)', c21.rows[0].bib === want[0].bib && c21.rows[0].time === want[0].time, JSON.stringify(c21.rows[0]));
	check('ranking order matches finish times', c21.rows.every((r, i) => r.bib === want[i].bib && r.rank === i + 1), c21.rows.slice(0, 5).map((r) => r.bib).join());
	check('splits present for CP1 and CP2', c21.rows[0].splits.length === 2, JSON.stringify(c21.rows[0].splits));
	const dnf = c21.progress.filter((p) => ['136', '137', '138'].includes(p.bib));
	note('DNF progress states: ' + dnf.map((p) => `${p.bib}:${p.state}/${p.last}`).join(' '));
	check('runners who stopped after CP1 are not ranked', !c21.rows.some((r) => ['136', '137', '138'].includes(r.bib)));
	const dns = c21.progress.filter((p) => ['139', '140'].includes(p.bib));
	check('no-shows are not finished or ranked', dns.every((p) => p.state !== 'finished' && p.rank === null), JSON.stringify(dns.map((p) => p.state)));
	await act(P, 'setReveal', { reveal: 'false' });
	const hid = (await resAdmin()).categories.find((c) => c.name === '21K');
	check('awards hidden from the public while not revealed', hid.awards.length === 0);
	const own = await resAdmin('own');
	const o21 = own.categories.find((c) => c.name === '21K');
	const r101 = o21.rows.find((r) => r.bib === '101');
	check('own (chip) mode times from the runner\'s own start read', r101.time === plan.find((p) => p.bib === '101').time - 3000, `${r101.time}`);
}

// ---------- EDGE READS ----------
group('Edge cases in reads');
{
	const t102 = await tagOf('102');
	// warm-up pass over the finish mat before the gun, then a second finish read after the real finish
	await up([rd(t102, 'Finish', T0 - min(15), 'FINISH-PC'), rd(t102, 'Finish', T0 + min(200), 'FINISH-PC')]);
	const res = await resAdmin();
	const r = res.categories.find((c) => c.name === '21K').rows.find((x) => x.bib === '102');
	check('warm-up read before the gun and a late double read do not change the finish', r.time === plan.find((p) => p.bib === '102').time, `${r.time}`);
	// lowercase tag, station name in different case, extra whitespace
	const t103 = await tagOf('103');
	const lc = await up([rd(t103.toLowerCase(), '  finish ', T0 + min(60), 'FINISH-PC2')]);
	const [row] = await sql("select station_id, bib from reads where event_id=$1 and device_id='FINISH-PC2'", [ev.id]);
	note(`lowercase/whitespace read stored station_id=${row?.station_id} bib=${row?.bib}`);
	check('lowercase tag still matched to the runner', row?.bib === '103', JSON.stringify(row));
	check('station name with different case/whitespace matched', row?.station_id === st.Finish, JSON.stringify(row));
	const r103 = (await resAdmin()).categories.find((c) => c.name === '21K').rows.find((x) => x.bib === '103');
	check('an earlier finish read from a 2nd finish laptop wins (first after start)', r103.time === min(60), `${r103.time}`);
	await act(P, 'voidRead', { id: (await sql("select id from reads where event_id=$1 and device_id='FINISH-PC2'", [ev.id]))[0].id, voided: 'true' });
	// unknown station name, then the organizer adds that station: the reads adopt it
	const t104 = await tagOf('104');
	await up([rd(t104, 'CP3 Peak', T0 + min(70), 'CP3-PC')]);
	const [u] = await sql("select station_id from reads where event_id=$1 and device_id='CP3-PC'", [ev.id]);
	check('read from an unknown station is stored, not lost', u && u.station_id === null, JSON.stringify(u));
	await act(P, 'addStation', { name: 'CP3 Peak', kind: 'checkpoint' });
	const [u2] = await sql("select station_id from reads where event_id=$1 and device_id='CP3-PC'", [ev.id]);
	check('adding the missing station adopts its earlier reads', u2.station_id !== null, JSON.stringify(u2));
	// unknown tag
	const unk = await up([rd('DEADBEEF', 'Finish', T0 + min(99), 'FINISH-PC')]);
	check('unknown tag stored without error', unk.status === 200 && unk.json.inserted === 1, JSON.stringify(unk.json));
	// station voids a finish read, re-sends restore
	const t105 = await tagOf('105');
	const fin105 = reads.find((x) => x.tag === t105 && x.station === 'Finish');
	await up([{ ...fin105, voided: true }]);
	let r105 = (await resAdmin()).categories.find((c) => c.name === '21K').rows.find((x) => x.bib === '105');
	check('station void removes the finish', !r105, JSON.stringify(r105));
	await up([{ ...fin105, voided: false }]);
	r105 = (await resAdmin()).categories.find((c) => c.name === '21K').rows.find((x) => x.bib === '105');
	check('station restore brings it back', !!r105);
	// admin void wins over a later station restore
	const [rid] = await sql("select id from reads where event_id=$1 and tag=$2 and station_id=$3", [ev.id, t105, st.Finish]);
	await act(P, 'voidRead', { id: rid.id, voided: 'true' });
	await up([{ ...fin105, voided: false }]);
	const [after] = await sql('select voided from reads where id=$1', [rid.id]);
	check('organizer\'s void is not undone by the station re-sending the read', after.voided === true, JSON.stringify(after));
	await act(P, 'voidRead', { id: rid.id, voided: 'false' });
	// shared tag (bug probe): 999 got 101's tag in phase 1
	const shared = await sql("select bib from participants where event_id=$1 and upper(tag)=(select upper(tag) from participants where event_id=$1 and bib='101')", [ev.id]);
	if (shared.length > 1) {
		const all = (await resAdmin()).categories.flatMap((c) => c.rows.map((r) => r.bib));
		check('a shared tag does not give two runners the same finish', !(all.includes('101') && all.includes('999')), `ranked: 101=${all.includes('101')} 999=${all.includes('999')}`);
	}
	// duplicate station name differing in case (bug probe)
	const dupSt = await sql('select name from stations where event_id=$1 and lower(name)=$2', [ev.id, 'cp1 ridge']);
	if (dupSt.length > 1) {
		const t106 = await tagOf('106');
		const r = await up([rd(t106, 'CP1 Ridge', T0 + min(41), 'CP1-PC-B')]);
		check('upload still works when two stations differ only by case', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
	}
	// 10K runner read at CP2 (not on the 10K course)
	const t201 = await tagOf('201');
	await up([rd(t201, cp1, T0 + min(40), 'CP1-PC'), rd(t201, cp2, T0 + min(50), 'CP2-PC'), rd(t201, 'Finish', T0 + min(70), 'FINISH-PC')]);
	const c10 = (await resAdmin()).categories.find((c) => c.name === '10K');
	const r201 = c10.rows.find((r) => r.bib === '201');
	check('10K: wave 1 runner timed from the wave gun (T0+10)', r201?.time === min(60), JSON.stringify(r201));
	check('10K: CP2 (not on its course) not shown as a split', r201?.splits.every((s) => s.station !== cp2), JSON.stringify(r201?.splits));
	const t225 = await tagOf('225');
	await up([rd(t225, 'Finish', T0 + min(75), 'FINISH-PC')]);
	const r225 = (await resAdmin()).categories.find((c) => c.name === '10K').rows.find((r) => r.bib === '225');
	check('10K: wave 2 runner timed from the wave 2 gun (T0+20)', r225?.time === min(55), JSON.stringify(r225));
	const c10b = (await resAdmin()).categories.find((c) => c.name === '10K').rows;
	check('10K: wave 2 runner (55 min) ranks above wave 1 runner (60 min)', c10b.findIndex((r) => r.bib === '225') < c10b.findIndex((r) => r.bib === '201'), c10b.map((r) => r.bib).join());
	// duo: first member's read finishes the team, the second member's later read changes nothing
	await up([rd('TAG-D301-1', 'Finish', T0 + min(65), 'FINISH-PC'), rd('TAG-D301-0', 'Finish', T0 + min(66), 'FINISH-PC')]);
	const d = (await resAdmin()).categories.find((c) => c.name === 'DUO');
	const t = d.rows.find((r) => r.bib === 'D301');
	check('duo team finishes on its first member read (gun T0+5)', t?.time === min(60), JSON.stringify(t));
	check('mixed duo labelled X (Mixed)', t?.gender === 'X', t?.gender);
	check('duo age = floor(avg)', t?.age === 31, String(t?.age));
}

// ---------- CORRECTIONS ----------
group('Corrections: override, penalty, bib renumber');
{
	const before = (await resAdmin()).categories.find((c) => c.name === '21K').rows;
	const second = before[1];
	const pen = await act(P, 'setPenalty', { bib: before[0].bib, minutes: '5', note: 'cut course' });
	let rows = (await resAdmin()).categories.find((c) => c.name === '21K').rows;
	const p = rows.find((r) => r.bib === before[0].bib);
	check('5 min penalty added to time', p.time === before[0].time + min(5) && p.penalty === min(5), JSON.stringify(pen));
	check('penalty can drop a runner\'s place', rows[0].bib === second.bib, rows.slice(0, 3).map((r) => r.bib).join());
	for (const bad of ['-1', '601', 'abc']) check(`penalty "${bad}" refused`, (await act(P, 'setPenalty', { bib: before[0].bib, minutes: bad })).type === 'failure');
	check('penalty for unknown bib -> 404', (await act(P, 'setPenalty', { bib: 'nope', minutes: '1' })).status === 404);
	await act(P, 'setPenalty', { bib: before[0].bib, minutes: '0' });
	// override: 137 (DNF after CP1) gets a manual finish
	const ov = await act(P, 'setFinishOverride', { bib: '137', finish_ms: T0 + min(150), reason: 'chip fell off', by: 'QA Tester' });
	rows = (await resAdmin()).categories.find((c) => c.name === '21K').rows;
	const o = rows.find((r) => r.bib === '137');
	check('finish override ranks a runner with no finish read', o?.time === min(150) && o.overridden, JSON.stringify(ov));
	const ovBad = await act(P, 'setFinishOverride', { bib: '137', finish_ms: T0 + min(150), reason: '', by: 'QA' });
	check('override without a reason refused', ovBad.type === 'failure');
	await act(P, 'setFinishOverride', { bib: '138', finish_ms: T0 - min(1), reason: 'typo test', by: 'QA' });
	const c = (await resAdmin()).categories.find((c) => c.name === '21K');
	check('override before the gun is not ranked and is flagged (badStart)', !c.rows.some((r) => r.bib === '138') && c.badStart >= 1, `badStart=${c.badStart}`);
	await act(P, 'clearFinishOverride', { bib: '138' });
	// renumber 110 -> 1110: reads follow
	const [p110] = await sql("select id, name, tag, category_id from participants where event_id=$1 and bib='110'", [ev.id]);
	const tBefore = (await resAdmin()).categories.find((c) => c.name === '21K').rows.find((r) => r.bib === '110').time;
	const ren = await act(P, 'updateParticipant', { id: p110.id, bib: '1110', name: p110.name, tag: p110.tag, category: p110.category_id });
	const r1110 = (await resAdmin()).categories.find((c) => c.name === '21K').rows.find((r) => r.bib === '1110');
	check('renumbering a bib keeps its reads and time', r1110?.time === tBefore, JSON.stringify(ren.data) + ' ' + JSON.stringify(r1110));
	const clash = await act(P, 'updateParticipant', { id: p110.id, bib: '111', name: 'x', tag: p110.tag, category: p110.category_id });
	check('renumbering onto a used bib refused', clash.type === 'failure' && /already used/.test(clash.data?.error), JSON.stringify(clash.data));
	await act(P, 'updateParticipant', { id: p110.id, bib: '110', name: p110.name, tag: p110.tag, category: p110.category_id });
	// deleting a station that has reads is blocked
	const del = await act(P, 'deleteStation', { id: st['CP1 Ridge'] });
	check('deleting a station with reads refused', del.type === 'failure', JSON.stringify(del.data));
	// manual read from the admin
	const m = await act(P, 'manualRead', { bib: '136', station: st['CP2 River'], ms: T0 + min(80) });
	const m2 = await act(P, 'manualRead', { bib: '136', station: st['CP2 River'], ms: T0 + min(80) });
	check('admin manual read added; exact duplicate refused', m.type === 'success' && m2.type === 'failure', JSON.stringify([m.data, m2.data]));
	check('manual read for unknown bib refused', (await act(P, 'manualRead', { bib: 'zzz', station: st.Finish, ms: T0 })).type === 'failure');
	check('manual read at another event\'s station refused', (await act(P, 'manualRead', { bib: '136', station: 999999, ms: T0 })).type === 'failure');
	// ranking modes
	await act(P, 'setRankBy', { id: cat['21K'], rank_by: 'finish' });
	const byFin = (await resAdmin()).categories.find((c) => c.name === '21K');
	check('rank by finish order works', byFin.rankBy === 'finish' && byFin.rows.length > 0);
	check('unknown ranking refused', (await act(P, 'setRankBy', { id: cat['21K'], rank_by: 'random' })).type === 'failure');
	await act(P, 'setRankBy', { id: cat['21K'], rank_by: 'elapsed' });
}

// ---------- RELEASE + AWARDS ----------
group('Release levels and awards');
{
	await act(P, 'setRelease', { scope: 'category', id: cat['21K'], level: 'checkpoints' });
	const [r101] = await sql("select id from participants where event_id=$1 and bib='101'", [ev.id]);
	await act(P, 'setRelease', { scope: 'runner', id: r101.id, level: 'released' });
	let c = (await resAdmin()).categories.find((c) => c.name === '21K');
	check('one runner released ahead of the category: only they show, place is provisional', c.rows.length === 1 && c.rows[0].bib === '101' && c.provisional === true, `rows=${c.rows.map((r) => r.bib + '#' + r.rank)}`);
	check('awards never shown while part of the category is held', c.awards.length === 0);
	check('bad release level refused', (await act(P, 'setRelease', { scope: 'all', level: 'everything' })).type === 'failure');
	await act(P, 'setRelease', { scope: 'all', level: 'released' });
	await act(P, 'setReveal', { reveal: 'true' });
	c = (await resAdmin()).categories.find((c) => c.name === '21K');
	check('after release all + reveal: awards appear', c.awards.length > 0 && c.awards[0].winners.length === 3, JSON.stringify(c.awards.map((a) => a.name)));
	const html = await (await fetch(`http://localhost:5299/admin/${ev.slug}/export?kind=results`, { headers: { cookie: (await import('./lib.mjs')).cookie } })).text();
	check('results CSV export downloads', html.includes('bib') || html.includes('Bib'), html.slice(0, 120));
}

const f = results.filter((r) => !r.ok);
console.log(`\nPhase 2: ${results.length - f.length}/${results.length} passed`);
await db.end();
