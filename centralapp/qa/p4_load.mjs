import { group, check, note, login, act, api, sql, results, db, T0, min, file, BASE } from './lib.mjs';
import * as L from './lib.mjs';

await login('qa-admin-pass-123');
const ms = async (f) => { const t = performance.now(); const r = await f(); return [r, Math.round(performance.now() - t)]; };
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

group('Public cannot change the finish wall');
{
	const { slug } = (await sql("select slug from events where slug='qa-trail-run-2026'"))[0];
	const [c] = await sql("select c.id from categories c join events e on e.id=c.event_id where e.slug=$1 limit 1", [slug]);
	const r = await act(`/e/${slug}/wall`, 'show', { category: c.id, bib: '101', name: 'HACKED' }, { cookie: '' });
	check('a stranger cannot put a runner on the display screen', r.type === 'failure' && r.status === 403 && !(await sql("select 1 from events where slug=$1 and wall_name='HACKED'", [slug])).length, JSON.stringify(r).slice(0, 150));
}

group('Load: 1,500 runners, 6 stations, 50 viewers');
const ev = await L.createEvent('QA Big Race');
const P = `/admin/${ev.slug}`;
for (const n of ['CP1', 'CP2', 'CP3', 'CP4']) await act(P, 'addStation', { name: n, kind: 'checkpoint' });
for (const c of ['50K', '21K', '10K']) await act(P, 'addCategory', { name: c });
const cats = Object.fromEntries((await sql('select id, name from categories where event_id=$1', [ev.id])).map((c) => [c.name, c.id]));
let csv = 'bib,name,gender,age,tag\n';
for (let i = 0; i < 1500; i++) csv += `${1000 + i},Runner ${i},${i % 2 ? 'M' : 'F'},${18 + (i % 55)},TAG${String(i).padStart(6, '0')}\n`;
{
	const [r, t] = await ms(() => act(P, 'importCsv', { category: String(cats['21K']), file: file('big.csv', csv) }));
	check(`import 1,500 runners (${t} ms)`, r.type === 'success' && r.data.imported === 1500 && t < 30000, JSON.stringify(r.data).slice(0, 100));
	await sql("update participants set category_id=$2 where event_id=$1 and bib::int < 1500", [ev.id, cats['50K']]);
	await sql("update participants set category_id=$2 where event_id=$1 and bib::int >= 2000", [ev.id, cats['10K']]);
	for (const c of Object.values(cats)) await act(P, 'startGun', { id: c, kind: 'category', ms: T0 });
	await act('/admin', 'publish', { id: ev.id, published: 'true' });
	await act(P, 'setRelease', { scope: 'all', level: 'released' });
}
const stations = ['Start', 'CP1', 'CP2', 'CP3', 'CP4', 'Finish'];
const reads = Object.fromEntries(stations.map((s) => [s, []]));
for (let i = 0; i < 1500; i++) {
	const pace = min(60) + i * 4000;
	stations.forEach((s, k) => reads[s].push({ tag: `TAG${String(i).padStart(6, '0')}`, station: s, read_at_ms: T0 + Math.round((pace * k) / 5) + 500, device_id: `${s}-PC`, src: `${s}:${i}` }));
}
// every mat reads a tag 3 times as the runner crosses
for (const s of stations) reads[s] = reads[s].flatMap((r) => [r, { ...r, read_at_ms: r.read_at_ms + 120, src: r.src + ':b' }, { ...r, read_at_ms: r.read_at_ms + 250, src: r.src + ':c' }]);
const total = Object.values(reads).reduce((n, a) => n + a.length, 0);
note(`${total} reads to upload`);
{
	const KEY = ev.api_key;
	let viewing = true;
	const viewTimes = [];
	const viewers = Array.from({ length: 50 }, async () => {
		while (viewing) {
			const [r, t] = await ms(() => fetch(`${BASE}/e/${ev.slug}/results?mode=gun`).then((x) => x.status));
			if (r === 200) viewTimes.push(t);
			else viewTimes.push(99999);
			await new Promise((s) => setTimeout(s, 300));
		}
	});
	const upTimes = [];
	const fails = [];
	const t0 = performance.now();
	await Promise.all(stations.map(async (s) => {
		const all = reads[s];
		for (let i = 0; i < all.length; i += 500) {
			const [r, t] = await ms(() => api('POST', `/api/events/${ev.slug}/reads`, { key: KEY, body: { reads: all.slice(i, i + 500) } }));
			upTimes.push(t);
			if (r.status !== 200) fails.push(r.status);
		}
	}));
	const upWall = Math.round(performance.now() - t0);
	// 30 marshal phones at the same time
	const taps = await Promise.all(Array.from({ length: 30 }, (_, i) => api('POST', `/api/events/${ev.slug}/reads`, { key: KEY, body: { reads: [{ tag: `BIB-${1000 + i}`, bib: String(1000 + i), station: 'CP2', read_at_ms: Date.now(), device_id: `Marshal ${i}`, server_time: true }] } })));
	viewing = false;
	await Promise.all(viewers);
	const n = (await sql('select count(*)::int n from reads where event_id=$1', [ev.id]))[0].n;
	note(`uploads: ${upTimes.length} batches of 500, all done in ${upWall} ms; p50 ${pct(upTimes, 0.5)} ms, p95 ${pct(upTimes, 0.95)} ms`);
	note(`board while uploading: ${viewTimes.length} loads, p50 ${pct(viewTimes, 0.5)} ms, p95 ${pct(viewTimes, 0.95)} ms, max ${Math.max(...viewTimes)} ms`);
	check('no station upload failed under load', fails.length === 0, fails.join());
	check('every read stored exactly once', n === total + 30, `${n} vs ${total + 30}`);
	check('all 30 marshal taps succeeded during the load', taps.every((t) => t.status === 200));
	check('no live board load failed under load', viewTimes.every((t) => t < 99999));
	check('live board p95 under 3 s while 6 stations upload', pct(viewTimes, 0.95) < 3000, `${pct(viewTimes, 0.95)} ms`);
	const again = await api('POST', `/api/events/${ev.slug}/reads`, { key: KEY, body: { reads: reads.Finish.slice(0, 500) } });
	check('a laptop re-sending 500 reads after a reconnect stores none twice', again.json.inserted === 0);
	const [res, t] = await ms(() => api('GET', `/e/${ev.slug}/results?mode=gun`));
	const ranked = res.json.categories.reduce((n, c) => n + c.rows.length, 0);
	note(`results for 1,500 finishers: ${t} ms, ${Math.round(res.text.length / 1024)} KB`);
	check('all 1,500 runners ranked with correct first-read times', ranked === 1500 && res.json.categories.find((c) => c.name === '50K').rows[0].bib === '1000', `ranked=${ranked}`);
	check('first read of each triple counts (not the 2nd/3rd)', res.json.categories.find((c) => c.name === '50K').rows[0].time === min(60) + 500 - 0, String(res.json.categories.find((c) => c.name === '50K').rows[0].time));
	const [adm, ta] = await ms(() => fetch(`${BASE}${P}`, { headers: { cookie: L.cookie } }));
	note(`admin event page with 1,500 runners: ${adm.status} in ${ta} ms`);
	check('admin page loads with a big event', adm.status === 200 && ta < 10000, `${ta} ms`);
}

group('Live stream connections');
{
	const ctrls = [];
	let pings = 0;
	await Promise.all(Array.from({ length: 100 }, async () => {
		const c = new AbortController();
		ctrls.push(c);
		const r = await fetch(`${BASE}/e/${ev.slug}/stream`, { signal: c.signal });
		const rd = r.body.getReader();
		(async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; if (new TextDecoder().decode(value).includes('update')) pings++; } } catch {} })();
	}));
	await api('POST', `/api/events/${ev.slug}/reads`, { key: ev.api_key, body: { reads: [{ tag: 'TAG000001', station: 'CP3', read_at_ms: T0 + 1, device_id: 'X', src: 'stream-test' }] } });
	await new Promise((s) => setTimeout(s, 1500));
	note(`${pings} of 100 open boards got the update ping`);
	check('100 open live boards all get the update ping', pings >= 100, String(pings));
	ctrls.forEach((c) => c.abort());
	const [r, t] = await ms(() => fetch(`${BASE}/e/${ev.slug}/results`).then((x) => x.status));
	check('server healthy after 100 boards disconnect', r === 200, `${r} ${t}ms`);
}

group('Login brute force (last: it blocks this address for 10 min)');
{
	const tries = [];
	for (let i = 0; i < 6; i++) tries.push((await L.login('guess-' + i)).body);
	check('6th wrong password in a row is blocked', /Too many/.test(tries[5]), tries[5].slice(0, 120));
	const right = await L.login('qa-admin-pass-123');
	check('even the right password is refused while blocked', !right.cookie, '');
}
const f = results.filter((r) => !r.ok);
console.log(`\nPhase 4: ${results.length - f.length}/${results.length} passed`);
await db.end();
