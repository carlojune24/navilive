import { group, check, note, login, act, api, sql, results, db, T0, min, results$ } from './lib.mjs';
await login('qa-admin-pass-123');
const [ev] = await sql("select id, slug, api_key from events where slug='qa-trail-run-2026'");
const P = `/admin/${ev.slug}`;
const rows = async () => (await results$(ev.slug)).categories.find((c) => c.name === '21K').rows;
const time = (rs, bib) => rs.find((r) => r.bib === bib)?.time ?? null;

group('Fix 1: correcting tags moves the reads');
{
	const [a] = await sql("select tag, category_id from participants where event_id=$1 and bib='120'", [ev.id]);
	const [b] = await sql("select tag from participants where event_id=$1 and bib='121'", [ev.id]);
	const before = await rows();
	const t120 = time(before, '120'), t121 = time(before, '121');
	const sw = await act(P, 'importCsv', { category: String(a.category_id), file: new File([`bib,tag\n120,${b.tag}\n121,${a.tag}`], 's.csv') });
	let after = await rows();
	check('swapping two runners\' tags swaps their times', time(after, '120') === t121 && time(after, '121') === t120, `${JSON.stringify(sw.data)} before 120=${t120} 121=${t121}; after 120=${time(after, '120')} 121=${time(after, '121')}`);
	await act(P, 'importCsv', { category: String(a.category_id), file: new File([`bib,tag\n120,${a.tag}\n121,${b.tag}`], 's.csv') });
	after = await rows();
	check('swapping back restores both', time(after, '120') === t120 && time(after, '121') === t121);
	// one runner's tag edited onto a spare tag that already has reads (the tag he really wore)
	await api('POST', `/api/events/${ev.slug}/reads`, { key: ev.api_key, body: { reads: [{ tag: 'SPARE-01', station: 'Finish', read_at_ms: T0 + min(77), device_id: 'FINISH-PC', src: 'spare' }] } });
	const [p139] = await sql("select id, name, category_id from participants where event_id=$1 and bib='139'", [ev.id]);
	await act(P, 'updateParticipant', { id: p139.id, bib: '139', name: p139.name, tag: 'SPARE-01', category: p139.category_id });
	check('editing a runner onto the tag he actually wore credits him its reads', time(await rows(), '139') === min(77), String(time(await rows(), '139')));
	// clearing the tag again un-credits them
	await act(P, 'updateParticipant', { id: p139.id, bib: '139', name: p139.name, tag: '', category: p139.category_id });
	const t = time(await rows(), '139');
	check('removing that tag takes its reads away again', t === null, String(t));
	// team: change a duo member's tag to one with reads
	await api('POST', `/api/events/${ev.slug}/reads`, { key: ev.api_key, body: { reads: [{ tag: 'SPARE-DUO', station: 'Finish', read_at_ms: T0 + min(70), device_id: 'FINISH-PC', src: 'spare-duo' }] } });
	await act(P, 'importTags', { file: new File(['bib,tag\nD302,SPARE-DUO'], 't.csv') });
	const d = (await results$(ev.slug)).categories.find((c) => c.name === 'DUO').rows.find((r) => r.bib === 'D302');
	check('a team given a tag that has reads gets them (tag-writer file)', d?.time === min(65), JSON.stringify(d));
	// marshal reads (BIB-xxx) and manual reads are never touched by tag edits
	const [mr] = await sql("select count(*)::int n from reads where event_id=$1 and tag like 'BIB-%' and bib <> substr(tag, 5)", [ev.id]);
	check('marshal taps keep their bib whatever tags change', mr.n === 0, String(mr.n));
}

const f = results.filter((r) => !r.ok);
console.log(`\nMust-fix checks: ${results.length - f.length}/${results.length} passed`);
await db.end();
