import { group, check, note, login, act, api, sql, results, db, T0, min, results$, file, BASE, cookie as _c } from './lib.mjs';
import * as L from './lib.mjs';
import { readFileSync } from 'node:fs';
const { ev, cat, st } = JSON.parse(readFileSync(new URL('./state.json', import.meta.url)));
await login('qa-admin-pass-123');
const P = `/admin/${ev.slug}`;
const KEY = (await sql('select api_key from events where id=$1', [ev.id]))[0].api_key;
const tap = (bib, station, at, by = 'Marshal Ana Cruz', voided = false) => ({ tag: `BIB-${bib}`, bib, station, read_at_ms: at, device_id: by, voided, server_time: true });
const send = (reads, key = KEY) => api('POST', `/api/events/${ev.slug}/reads`, { key, body: { reads } });

// ---------- MARSHAL ----------
group('Marshal phone (manual tagging)');
{
	const b = await api('GET', `/api/events/${ev.slug}/board`, { key: KEY });
	check('marshal board loads with the event key', b.status === 200 && b.json.stations.length >= 4 && b.json.participants.length > 70, `${b.status}`);
	check('marshal board gives the server clock', Math.abs(b.json.serverMs - Date.now()) < 5000);
	// a runner tagged at CP1 by phone; the phone clock is 10 minutes wrong, so the server stamps it
	const phoneWrong = Date.now() - 4000; // the phone already corrects its clock; a prompt tap is stamped by the server
	const t1 = await send([tap('139', 'CP1 Ridge', phoneWrong)]);
	const [r] = await sql("select read_at_ms, client_ms, device_id from reads where event_id=$1 and bib='139'", [ev.id]);
	note(`tap: ${JSON.stringify(t1.json)} stored at ${new Date(Number(r?.read_at_ms)).toISOString()} (phone said ${new Date(phoneWrong).toISOString()})`);
	check('a prompt marshal tap is stamped with the server clock', r && Number(r.read_at_ms) > phoneWrong, JSON.stringify(r));
	const late = Date.now() - min(10);
	await send([tap('215', 'CP1 Ridge', late)]);
	const [lr] = await sql("select read_at_ms from reads where event_id=$1 and bib='215'", [ev.id]);
	check('a tap queued offline and sent 10 min later keeps its real time', Number(lr.read_at_ms) === late, JSON.stringify(lr));
	const again = await send([tap('139', 'CP1 Ridge', phoneWrong)]);
	check('the phone re-sending the same tap stores nothing new', again.json.inserted === 0 && (await sql("select count(*)::int n from reads where event_id=$1 and bib='139'", [ev.id]))[0].n === 1, JSON.stringify(again.json));
	const undo = await send([tap('139', 'CP1 Ridge', phoneWrong, 'Marshal Ana Cruz', true)]);
	check('undo before the runner moves on is accepted', undo.json.updated === 1 && (await sql("select voided from reads where event_id=$1 and bib='139'", [ev.id]))[0].voided === true, JSON.stringify(undo.json));
	await send([tap('139', 'CP1 Ridge', phoneWrong, 'Marshal Ana Cruz', false)]);
	await send([tap('139', 'CP2 River', Date.now() + 1000, 'Marshal Ben Reyes')]);
	const locked = await send([tap('139', 'CP1 Ridge', phoneWrong, 'Marshal Ana Cruz', true)]);
	check('undo at CP1 refused once the runner has a CP2 read (server-side)', locked.json.locked?.length === 1 && (await sql("select voided from reads r join stations s on s.id=r.station_id where r.event_id=$1 and bib='139' and s.name='CP1 Ridge'", [ev.id]))[0].voided === false, JSON.stringify(locked.json));
	// a 10K runner (course skips CP2) tagged at CP1, then read at Finish: locked by the finish
	await send([tap('210', 'CP1 Ridge', T0 + min(30), 'Marshal Ana Cruz')]);
	await api('POST', `/api/events/${ev.slug}/reads`, { key: KEY, body: { reads: [{ tag: (await sql("select tag from participants where event_id=$1 and bib='210'", [ev.id]))[0].tag, station: 'Finish', read_at_ms: Date.now(), device_id: 'FINISH-PC', src: 'x210' }] } });
	const lk2 = await send([tap('210', 'CP1 Ridge', T0 + min(30), 'Marshal Ana Cruz', true)]);
	check('undo refused once the runner has a finish read', lk2.json.locked?.length === 1, JSON.stringify(lk2.json));
	// the finish marshal may still undo their own finish tap
	await send([tap('211', 'Finish', T0 + min(70), 'Marshal Finish')]);
	const fu = await send([tap('211', 'Finish', T0 + min(70), 'Marshal Finish', true)]);
	check('the finish marshal can undo their own finish tap', fu.json.updated === 1 && !fu.json.locked?.length, JSON.stringify(fu.json));
	// mixed batch: one undo locked, one fine, one new tap -> only the locked one refused
	await send([tap('212', 'CP1 Ridge', T0 + min(31), 'Marshal Ana Cruz')]);
	const mix = await send([tap('139', 'CP1 Ridge', phoneWrong, 'Marshal Ana Cruz', true), tap('212', 'CP1 Ridge', T0 + min(31), 'Marshal Ana Cruz', true), tap('213', 'CP1 Ridge', T0 + min(32), 'Marshal Ana Cruz')]);
	check('a queued batch with one locked undo: the rest still goes through', mix.json.locked?.join() === '0' && mix.json.updated === 1 && mix.json.inserted === 1, JSON.stringify(mix.json));
	// an undo for a tap the server never got
	const ghost = await send([tap('214', 'CP1 Ridge', T0 + min(33), 'Marshal Ana Cruz', true)]);
	check('an undo for a tap the server never received is harmless', ghost.status === 200, JSON.stringify(ghost.json));
	// 30 phones tapping at the same moment
	const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => send([tap(String(101 + i), 'CP2 River', Date.now(), `Marshal ${i}`)])));
	check('30 marshal phones tapping at once all succeed', burst.every((r) => r.status === 200), burst.map((r) => r.status).filter((s) => s !== 200).join());
}

// ---------- KEY ROTATION / ARCHIVE ----------
group('Station key and event lifecycle');
{
	await act(P, 'rotateKey', {});
	const [{ api_key: NEW }] = await sql('select api_key from events where id=$1', [ev.id]);
	check('after a new key: the old key is refused', (await send([tap('101', 'CP1 Ridge', Date.now())], KEY)).status === 401);
	check('after a new key: the new key works', (await send([tap('101', 'CP1 Ridge', Date.now())], NEW)).status === 200);
	const copy = await act('/admin', 'duplicate', { id: ev.id, name: 'QA Copy', date: '' });
	const [cp] = await sql("select id, slug from events where name='QA Copy'");
	const counts = cp && (await sql('select (select count(*)::int from participants where event_id=$1) p, (select count(*)::int from reads where event_id=$1) r, (select count(*)::int from stations where event_id=$1) s, (select count(*)::int from team_members where event_id=$1) m', [cp.id]))[0];
	note('copy: ' + JSON.stringify(counts));
	check('duplicate copies runners, stations and team members but no reads', counts && counts.p > 70 && counts.r === 0 && counts.s === 5 && counts.m >= 8, JSON.stringify(copy.data ?? copy));
	const [cpk] = await sql('select api_key from events where id=$1', [cp.id]);
	check('the copy has its own key (old event key not valid there)', (await api('POST', `/api/events/${cp.slug}/reads`, { key: NEW, body: { reads: [tap('101', 'Start', Date.now())] } })).status === 401 && cpk.api_key !== NEW);
	await act('/admin', 'archive', { id: cp.id });
	check('archived event refuses station uploads', (await api('POST', `/api/events/${cp.slug}/reads`, { key: cpk.api_key, body: { reads: [tap('101', 'Start', Date.now())] } })).status === 401);
	check('purge refused for an event not in Deleted', (await act('/admin', 'purge', { id: ev.id })) && (await sql('select 1 from events where id=$1', [ev.id])).length === 1);
	await act('/admin', 'remove', { id: cp.id });
	await act('/admin', 'purge', { id: cp.id });
	check('Delete now removes a deleted event and all its data', !(await sql('select 1 from events where id=$1', [cp.id])).length && !(await sql('select 1 from participants where event_id=$1', [cp.id])).length);
	const clr = await act(P, 'clearReads', { confirm: 'clear' });
	check('Clear reads needs the exact word CLEAR', clr.type === 'failure' && (await sql('select count(*)::int n from reads where event_id=$1', [ev.id]))[0].n > 0);
}

// ---------- PUBLIC SURFACE OF A DRAFT ----------
group('Draft event: nothing leaks to the public');
{
	await act('/admin', 'publish', { id: ev.id, published: 'false' });
	const [pid] = await sql("select id from categories where event_id=$1 limit 1", [ev.id]);
	for (const path of ['', '/results', '/starts', '/stream', '/map', '/map/data', '/wall', '/wall/display', '/photo/101', '/sponsor/1', `/wall/backdrop/${pid.id}`]) {
		const r = await fetch(`${BASE}/e/${ev.slug}${path}`, { redirect: 'manual' });
		check(`draft: /e/<slug>${path || '/'} is 404 publicly`, r.status === 404, String(r.status));
		r.body?.cancel?.();
	}
	const wallAdmin = await fetch(`${BASE}/e/${ev.slug}/wall`, { headers: { cookie: L.cookie }, redirect: 'manual' });
	note('finish wall operator page for admin: ' + wallAdmin.status);
	await act('/admin', 'publish', { id: ev.id, published: 'true' });
	const res = await api('GET', `/e/${ev.slug}/results`);
	check('published: results open to the public', res.status === 200);
	const pr = res.json.categories.flatMap((c) => c.progress);
	check('public results never include marshal names', pr.every((p) => (p.by ?? []).every((x) => x === null)), JSON.stringify(pr.find((p) => (p.by ?? []).some((x) => x))));
	const st = await api('GET', `/e/${ev.slug}/starts`);
	check('public Start view (if on) shows no names of runners not yet rolled', st.status === 404 || (st.json?.categories ?? []).every((c) => c.free.length === 0), JSON.stringify(st.json).slice(0, 200));
}

// ---------- UPLOAD SAFETY ----------
group('Uploads: images, links, CSV formulas');
{
	const html = new File(['<html><script>alert(1)</script></html>'], 'logo.png', { type: 'image/png' });
	const r = await act('/admin/settings', 'logo', { logo: html });
	check('a disguised HTML file is refused as the logo', r.type === 'failure', JSON.stringify(r.data));
	const big = new File([new Uint8Array(600_000)], 'big.png', { type: 'image/png' });
	const r2 = await act('/admin/settings', 'logo', { logo: big });
	check('an oversized logo is refused cleanly', r2.type === 'failure' || r2.httpStatus === 413, `${r2.httpStatus} ${JSON.stringify(r2.data ?? r2.text?.slice(0, 80))}`);
	const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000050001F5E2B0D90000000049454E44AE426082', 'hex');
	const ok = await act('/admin/settings', 'logo', { logo: new File([png], 'l.png', { type: 'image/png' }) });
	const lg = await fetch(`${BASE}/logo`);
	check('a real PNG logo is saved and served as an image with a sandbox CSP', ok.type === 'success' && lg.headers.get('content-type') === 'image/png' && /sandbox/.test(lg.headers.get('content-security-policy') ?? ''), `${ok.type} ${lg.headers.get('content-type')}`);
	check('unknown theme refused', (await act('/admin/settings', 'theme', { theme: 'hacker' })).type === 'failure');
	for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x']) {
		const s = await act(`${P}/sponsors`, 'add', { name: 'Evil', url, logo: new File([png], 'l.png', { type: 'image/png' }) });
		check(`sponsor link "${url.slice(0, 15)}" refused`, s.type === 'failure', JSON.stringify(s.data));
	}
	await act(P, 'addParticipant', { bib: '180', name: '=HYPERLINK("http://evil","click")', category: String(cat['21K']) });
	const csv = await (await fetch(`${BASE}${P}/export?kind=participants`, { headers: { cookie: L.cookie } })).text();
	const line = csv.split('\r\n').find((l) => l.startsWith('180,'));
	check('a name starting with = is exported as text, not a spreadsheet formula', line && line.includes("'=HYPERLINK"), line);
	const photo = await act(P, 'uploadPhoto', { id: (await sql("select id from participants where event_id=$1 and bib='101'", [ev.id]))[0].id, photo: html });
	check('a disguised file is refused as a winner photo', photo.type === 'failure');
}

const f = results.filter((r) => !r.ok);
console.log(`\nPhase 3: ${results.length - f.length}/${results.length} passed`);
await db.end();
