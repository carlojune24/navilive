import { group, check, note, login, act, api, get, sql, createEvent, file, results, db, BASE } from './lib.mjs';
import { writeFileSync } from 'node:fs';

// ---------- AUTH / ACCESS ----------
group('Auth and access control');
{
	const r = await get('/admin', false);
	check('admin without session redirects to /login', r.status === 303 && r.headers.get('location') === '/login', `${r.status} ${r.headers.get('location')}`);
	const ex = await get('/admin/anything/export?kind=reads', false);
	check('admin export without session is blocked', ex.status === 303, String(ex.status));
	const bad = await login('wrong-password');
	check('wrong password rejected', !bad.cookie && /Wrong password/.test(bad.body), bad.body.slice(0, 120));
	const ok = await login('qa-admin-pass-123');
	check('right password signs in (session cookie set)', !!ok.cookie && /httponly/i.test(ok.cookie) && /samesite=lax/i.test(ok.cookie), ok.cookie);
	const a = await get('/admin');
	check('admin reachable with session', a.status === 200, String(a.status));
	const forged = await fetch(BASE + '/admin', { headers: { cookie: 'rc_session=forged' }, redirect: 'manual' });
	check('forged session cookie rejected', forged.status === 303, String(forged.status));
	const csrf = await act('/admin', 'create', { name: 'CSRF attack' }, { origin: 'https://evil.example' });
	check('cross-site form post blocked (CSRF)', csrf.httpStatus === 403 && !(await sql("select 1 from events where name='CSRF attack'")).length, `${csrf.httpStatus}`);
}

// ---------- EVENTS ----------
group('Events');
const ev = await createEvent('QA Trail Run 2026', '2026-11-23');
check('create event -> redirect to its admin page', ev.slug === 'qa-trail-run-2026' && ev.r.type === 'redirect', JSON.stringify(ev.r).slice(0, 200));
check('new event gets an API key and Start/Finish stations', !!ev.api_key && (await sql('select kind from stations where event_id=$1 order by ord', [ev.id])).map((s) => s.kind).join() === 'start,finish');
check('new event is a draft (unpublished)', (await sql('select published from events where id=$1', [ev.id]))[0].published === false);
{
	const dup = await act('/admin', 'create', { name: 'qa trail run 2026' });
	check('duplicate event name refused', dup.type === 'failure' && /exists/.test(dup.data?.error), JSON.stringify(dup.data));
	for (const n of ['Settings', 'guide', 'Account', '!!!']) {
		const r = await act('/admin', 'create', { name: n });
		check(`reserved/empty slug refused: "${n}"`, r.type === 'failure', JSON.stringify(r.data ?? r));
	}
	const pub = await fetch(`${BASE}/e/${ev.slug}`, { redirect: 'manual' });
	check('draft event board is 404 for the public', pub.status === 404, String(pub.status));
	const pubRes = await api('GET', `/e/${ev.slug}/results`);
	check('draft event results JSON is 404 for the public', pubRes.status === 404, String(pubRes.status));
	const adm = await get(`/e/${ev.slug}`);
	check('draft event board visible to the signed-in admin', adm.status === 200, String(adm.status));
	const ren = await act('/admin', 'rename', { id: ev.id, name: '  QA Trail Run 2026 (renamed)  ' });
	const [rr] = await sql('select name, slug from events where id=$1', [ev.id]);
	check('rename changes name, keeps slug, trims', rr.name === 'QA Trail Run 2026 (renamed)' && rr.slug === ev.slug, JSON.stringify(rr));
	const ren2 = await act('/admin', 'rename', { id: ev.id, name: '   ' });
	check('rename to blank refused', ren2.type === 'failure', JSON.stringify(ren2.data));
	const xss = '<img src=x onerror=alert(1)>';
	await act('/admin', 'rename', { id: ev.id, name: xss });
	const html = await (await get('/admin')).text();
	check('event name is HTML-escaped in the admin list (no XSS)', !html.includes(xss) && html.includes('&lt;img'), '');
	await act('/admin', 'rename', { id: ev.id, name: 'QA Trail Run 2026' });
}

// ---------- STATIONS / CATEGORIES ----------
group('Stations and categories');
const P = `/admin/${ev.slug}`;
for (const [name, kind] of [['CP1 Ridge', 'checkpoint'], ['CP2 River', 'checkpoint']]) await act(P, 'addStation', { name, kind });
{
	const d = await act(P, 'addStation', { name: 'cp1 ridge', kind: 'checkpoint' });
	check('duplicate station name (other case) not added twice', (await sql('select count(*)::int n from stations where event_id=$1 and lower(name)=$2', [ev.id, 'cp1 ridge']))[0].n === 1, JSON.stringify(d.data));
	const bk = await act(P, 'addStation', { name: 'X', kind: 'teleport' });
	check('station with unknown kind refused', bk.type === 'failure');
	const st = await sql('select name, kind, ord from stations where event_id=$1 order by ord', [ev.id]);
	note('stations: ' + st.map((s) => `${s.name}(${s.kind},${s.ord})`).join(' '));
	const dupe = await act(P, 'addStation', { name: 'CP1 RIDGE', kind: 'checkpoint' });
	check('station differing only by case refused with a warning', !!dupe.data?.warning, JSON.stringify(dupe.data));
}
for (const c of ['21K', '10K', 'DUO']) await act(P, 'addCategory', { name: c });
{
	const d = await act(P, 'addCategory', { name: '21K' });
	check('duplicate category refused with a warning', !!d.data?.warning, JSON.stringify(d.data));
	const e = await act(P, 'addCategory', { name: '  ' });
	check('blank category refused', e.type === 'failure');
}
const cat = Object.fromEntries((await sql('select id, name from categories where event_id=$1', [ev.id])).map((c) => [c.name, c.id]));
const st = Object.fromEntries((await sql('select id, name from stations where event_id=$1', [ev.id])).map((s) => [s.name, s.id]));
// 10K skips CP2
{
	const r = await act(P, 'saveCourses', { courses: JSON.stringify({ [cat['10K']]: [st.Start, st['CP1 Ridge'], st.Finish] }) });
	check('course saved for 10K (skips CP2)', r.type === 'success', JSON.stringify(r));
	const bad = await act(P, 'saveCourses', { courses: JSON.stringify({ [cat['10K']]: [st.Start, st.Start] }) });
	check('course listing a station twice refused', bad.type === 'failure');
	const other = await act(P, 'saveCourses', { courses: JSON.stringify({ [cat['10K']]: [999999] }) });
	check('course with a foreign station id refused', other.type === 'failure');
}

// ---------- PARTICIPANT IMPORT ----------
group('Participant import');
const first = ['Juan', 'Maria', 'José', 'Ana', 'Pedro', 'Luz', 'Ramon', 'Carmen', 'Nestor', 'Liza', 'Ñino', 'Gloria', 'Ben', 'Joy', 'Rico', 'Mae', 'Dan', 'Kim', 'Leo', 'Ivy'];
const last = ['Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Peña', 'Castillo'];
let csv21 = 'bib,name,gender,age,tag,team\n';
for (let i = 1; i <= 40; i++) csv21 += `${100 + i},${first[i % 20]} ${last[i % 10]},${i % 3 ? 'M' : 'F'},${18 + ((i * 7) % 50)},E2000017${String(i).padStart(4, '0')},${i % 4 ? 'Davao Runners' : 'Team Grit'}\n`;
{
	const r = await act(P, 'importCsv', { category: String(cat['21K']), file: file('21k.csv', '﻿' + csv21) });
	check('21K CSV with BOM imports 40 runners', r.type === 'success' && (await sql('select count(*)::int n from participants where category_id=$1', [cat['21K']]))[0].n === 40, JSON.stringify(r.data));
	const [p] = await sql("select name, extra from participants where event_id=$1 and bib='111'", [ev.id]);
	const [pn] = await sql("select name from participants where event_id=$1 and bib='110'", [ev.id]);
	check('UTF-8 ñ kept in names', pn.name.startsWith('Ñino'), pn.name);
	check('extra column (team) kept for custom awards', p.extra?.team === 'Davao Runners', JSON.stringify(p.extra));
}
{
	// 10K: semicolon, Excel ANSI (windows-1252) ñ, quoted comma, blank lines, bad age, odd gender spellings
	const lines = ['Bib;Name;Gender;Age;Tag', ...Array.from({ length: 30 }, (_, i) => `${201 + i};"Runner, ${i}";${['Male', 'female', 'm', 'F', 'W'][i % 5]};${i === 3 ? 'abc' : 20 + i};T10K${i}`), '', '231;Peña Ñ;M;40;T10KX'];
	const ansi = Buffer.from(lines.join('\r\n'), 'latin1');
	const r = await act(P, 'importCsv', { category: String(cat['10K']), file: new File([ansi], '10k.csv') });
	note('10K import result: ' + JSON.stringify(r.data).slice(0, 300));
	const n = (await sql('select count(*)::int n from participants where category_id=$1', [cat['10K']]))[0].n;
	check('10K semicolon/ANSI file imported', n >= 29, `n=${n}`);
	const [pn] = await sql("select name from participants where event_id=$1 and bib='231'", [ev.id]);
	check('Excel ANSI ñ decoded correctly (not �)', pn?.name === 'Peña Ñ', pn?.name);
	const [q] = await sql("select name from participants where event_id=$1 and bib='201'", [ev.id]);
	check('quoted name with a comma kept whole', q?.name === 'Runner, 0', q?.name);
	const g = await sql("select bib, gender from participants where event_id=$1 and bib in ('201','202','203','204','205') order by bib", [ev.id]);
	note('genders: ' + g.map((x) => x.bib + '=' + x.gender).join(' '));
	check('gender spellings normalised (Male/female/m/F)', g.slice(0, 4).map((x) => x.gender).join('') === 'MFMF', JSON.stringify(g));
	const [bad] = await sql("select age from participants where event_id=$1 and bib='204'", [ev.id]);
	check('invalid age does not crash import', bad !== undefined, JSON.stringify(bad));
	const nocat = await act(P, 'importCsv', { category: '', file: file('x.csv', 'bib\n999') });
	check('import without choosing a category refused', nocat.type === 'failure');
	const foreign = await act(P, 'importCsv', { category: '999999', file: file('x.csv', 'bib\n999') });
	check('import into another event\'s category refused', foreign.type === 'failure');
}
{
	// re-import the same file: no duplicates, edits applied
	const edited = csv21.replace('101,', '101,').replace(/^101,[^,]*/m, '101,Juan Edited');
	const r = await act(P, 'importCsv', { category: String(cat['21K']), file: file('21k.csv', edited) });
	const n = (await sql('select count(*)::int n from participants where category_id=$1', [cat['21K']]))[0].n;
	const [p] = await sql("select name from participants where event_id=$1 and bib='101'", [ev.id]);
	check('re-importing the same file updates, never duplicates', n === 40 && p.name === 'Juan Edited', `n=${n} name=${p.name} ${JSON.stringify(r.data).slice(0, 200)}`);
}
{
	// duplicate tag across runners
	const r = await act(P, 'addParticipant', { bib: '999', name: 'Tag Thief', tag: 'E20000170001', category: String(cat['21K']) });
	check('adding a runner with another runner\'s tag refused', r.type === 'failure' && /tag/i.test(r.data?.error), JSON.stringify(r.data));
	const [p101] = await sql("select id, name, category_id from participants where event_id=$1 and bib='102'", [ev.id]);
	const up = await act(P, 'updateParticipant', { id: p101.id, bib: '102', name: p101.name, tag: 'e20000170001', category: p101.category_id });
	check('editing a runner onto another runner tag (other case) refused with the bib named', up.type === 'failure' && /101/.test(up.data?.error), JSON.stringify(up.data));
	const csvDup = await act(P, 'importCsv', { category: String(cat['21K']), file: file('d.csv', `bib,name,tag
150,New A,E20000170003
151,New B,ZZZ1`) });
	check('CSV giving a used tag to a new runner refused, whole file rolled back', csvDup.type === 'failure' && !(await sql("select 1 from participants where event_id=$1 and bib in ('150','151')", [ev.id])).length, JSON.stringify(csvDup.data));
	const swap = await act(P, 'importCsv', { category: String(cat['21K']), file: file('s.csv', `bib,tag
103,E20000170004
104,E20000170003`) });
	const sw = await sql("select bib, tag from participants where event_id=$1 and bib in ('103','104') order by bib", [ev.id]);
	check('a file that swaps two runners tags imports', swap.type === 'success' && sw[0].tag === 'E20000170004' && sw[1].tag === 'E20000170003', JSON.stringify([swap.data, sw]));
	await act(P, 'importCsv', { category: String(cat['21K']), file: file('s.csv', `bib,tag
103,E20000170003
104,E20000170004`) });
	const tagsFile = await act(P, 'importTags', { file: file('t.csv', `bib,tag
105,E20000170006`) });
	check('tag-writer file giving a used tag refused', tagsFile.type === 'failure' && /106/.test(tagsFile.data?.error), JSON.stringify(tagsFile.data));
	const many = await Promise.all(['160', '161', '162'].map((b) => act(P, 'addParticipant', { bib: b, name: 'Race ' + b, tag: 'RACETAG' })));
	check('3 runners added at once with the same new tag: only one gets it', many.filter((r) => r.type === 'success').length === 1, many.map((r) => r.type).join());
	await sql("delete from participants where event_id=$1 and bib in ('160','161','162')", [ev.id]);
	const r2 = await act(P, 'addParticipant', { bib: '', name: 'No bib' });
	check('adding a runner without bib refused', r2.type === 'failure');
	const r3 = await act(P, 'addParticipant', { bib: '998', name: 'Old', age: '150' });
	check('age 150 refused', r3.type === 'failure');
	const r4 = await act(P, 'addParticipant', { bib: '141', name: 'Walk Up', category: String(cat['21K']), gender: 'F', age: '33' });
	check('walk-up registration added', r4.type === 'success' && (await sql("select 1 from participants where event_id=$1 and bib='141'", [ev.id])).length === 1, JSON.stringify(r4.data));
}
{
	// team CSV (DUO): per-runner rows with Team Name, Captain/Teammate
	const t = ['Bib,Team Name,First Name,Last Name,Gender,Age,Role,Tag'];
	const teams = [['D301', 'The Hybrids', [['Ana', 'Lim', 'F', 30], ['Ben', 'Lim', 'M', 33]]], ['D302', 'Speed Bros', [['Carl', 'Go', 'M', 25], ['Dan', 'Go', 'M', 27]]], ['D303', 'Sisters', [['Eve', 'Uy', 'F', 41], ['Fe', 'Uy', 'F', 45]]], ['D304', 'Young Ones', [['Gil', 'Ty', 'M', 19], ['Hana', 'Ty', 'F', 20]]]];
	for (const [bib, name, ms] of teams) ms.forEach(([f, l, g, a], i) => t.push(`${bib},${name},${f},${l},${g},${a},${i ? 'Teammate' : 'Captain'},TAG-${bib}-${i}`));
	const r = await act(P, 'importCsv', { category: String(cat.DUO), file: file('duo.csv', t.join('\n')) });
	note('team import: ' + JSON.stringify(r.data).slice(0, 300));
	const tm = await sql('select p.bib, count(m.id)::int n from participants p join team_members m on m.participant_id=p.id where p.category_id=$1 group by p.bib order by p.bib', [cat.DUO]);
	check('4 duo teams with 2 members each', tm.length === 4 && tm.every((x) => x.n === 2), JSON.stringify(tm));
}
{
	group('Shared bibs (duo/relay)');
	const r = await act(P, 'importCsv', { category: String(cat.DUO), file: file('duo-plain.csv', `bib,name,gender,age,tag
D305,Ivan Co,M,30,TAG-D305-A
D305,Joan Co,F,28,TAG-D305-B`) });
	const rows = await sql("select p.name, p.tag, (select count(*)::int from team_members m where m.participant_id=p.id) n from participants p where event_id=$1 and bib='D305'", [ev.id]);
	note('plain file, same bib twice: ' + JSON.stringify(r.data) + ' -> ' + JSON.stringify(rows));
	check('two members under one bib in a plain file are not silently overwritten', r.type === 'failure' || (rows[0] && rows[0].n === 2) || (r.data?.skipped ?? []).some((x) => /D305/.test(x)), JSON.stringify(rows));
	await sql("delete from participants where event_id=$1 and bib='D305'", [ev.id]);
	const t = await act(P, 'importCsv', { category: String(cat.DUO), file: file('duo-team.csv', `Bib,Team Name,First Name,Last Name,Gender,Age,Role,Tag
D306,Shared Tag,Kai,Ong,M,30,Captain,TEAMTAG306
D306,Shared Tag,Lea,Ong,F,29,Teammate,TEAMTAG306`) });
	check('duo members of one bib may share the team tag', t.type === 'success' && (await sql("select count(*)::int n from team_members m join participants p on p.id=m.participant_id where p.bib='D306' and m.tag='TEAMTAG306'"))[0].n === 2, JSON.stringify(t.data));
	const steal = await act(P, 'importCsv', { category: String(cat.DUO), file: file('duo-steal.csv', `Bib,Team Name,First Name,Last Name,Gender,Age,Role,Tag
D307,Thieves,Max,Li,M,30,Captain,TEAMTAG306
D307,Thieves,Nia,Li,F,29,Teammate,TAG-D307-B`) });
	check('another team cannot take a tag a team already wears', steal.type === 'failure', JSON.stringify(steal.data));
	const solo = await act(P, 'addParticipant', { bib: '170', name: 'Solo Thief', tag: 'TAG-D301-0', category: String(cat['21K']) });
	check('a solo runner cannot take a duo member tag', solo.type === 'failure' && /D301/.test(solo.data?.error), JSON.stringify(solo.data));
}
writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify({ ev, cat, st }));
const f = results.filter((r) => !r.ok);
console.log(`\nPhase 1: ${results.length - f.length}/${results.length} passed`);
await db.end();
